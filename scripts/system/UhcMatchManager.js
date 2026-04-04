import { GameMode, InputPermissionCategory, system, world, Difficulty } from "@minecraft/server";

// @ts-ignore
import {
  clearAllPlayerNametags,
  clearAllTaguhcAndDynamicProperty,
  getAllPlayers,
  getPlayerTeam,
  getTeamInfo,
  getUhcPlayers,
  registerAliveTeamDirtyHandler,
  refreshPlayerCaches,
  refreshScoreboardUI,
  resetAnnouncer,
  setGameRunningState,
  showVictoryMessage,
} from "../Manager/TeamManager.js";

// @ts-ignore
import { spawnLeaderboardNPC } from "../Manager/Leaderboard.js";

// @ts-ignore
import { dynamicToast } from "../plugin/Util.js";
// @ts-ignore
import { fillReset } from "./BlockFiller.js";
// @ts-ignore
import {
  borderManagerSyncGeometry,
  borderManagerTick,
  borderManagerTickShrink,
  broadcast,
  center,
  ctx,
  endSequenceReset,
  icons,
  particleRendererTick,
  resetBorderState,
  resetContext,
  resetUiState,
  scoreboardClear,
  scoreboardInit,
  scoreboardUpdate,
  ticks,
  MinecraftColor,
} from "./BorderManager.js";

// @ts-ignore
import {
  playerSetupAddItems,
  playerSetupApplyEndState,
  playerSetupApplyStartState,
  playerSetupClearItemsKeepCompass,
  playerSetupClearEffects,
} from "./UtilUhcMatchManager.js";

const safeYCache = new Map();

// ======================================================
// getAllPlayersCached (ดึงผู้เล่นทั้งหมดจากแคช)
// ======================================================
function getAllPlayersCached() {
  const players = getAllPlayers();
  if (players.length > 0) return players;

  // ป้องกันเซิร์ฟเวอร์ Drain CPU ในกรณีที่ว่างเปล่า (ไม่มีผู้เล่นออนไลน์เลย)
  if (world.getPlayers().length === 0) return players;

  refreshPlayerCaches();
  return getAllPlayers();
}

// ======================================================
// getUhcPlayersCached (ดึงผู้เล่น UHC จากแคช)
// ======================================================
function getUhcPlayersCached() {
  const players = getUhcPlayers();
  if (players.length > 0) return players;

  // ป้องกันเซิร์ฟเวอร์ Drain CPU ในกรณีที่ว่างเปล่า (ไม่มีผู้เล่นออนไลน์เลย)
  if (world.getPlayers().length === 0) return players;

  refreshPlayerCaches();
  return getUhcPlayers();
}
// =========================================================================================================================
// ==================================== teleport +  Queue ==================================================================
// =========================================================================================================================

const TELEPORT_CONFIG = Object.freeze({
  PRELOAD_Y: 200,
  PRELOAD_DELAY: 2,
  LEADER_SETTLE_TICKS: 5,
  MEMBER_INTERVAL: 3,
  MAX_RETRIES: 3,
  DEFAULT_Y: 120,
  MIN_Y: -64,
  MAX_Y: 320,
  MAX_SPAWN_RADIUS: 490,
});

// ======================================================
// ค้นหาตำแหน่ง Y ที่ปลอดภัยสำหรับการเทเลพอร์ต (หาความสูง (Y) ที่ปลอดภัย สำหรับวาร์ปผู้เล่น)
// ======================================================
function teleportManagerGetSafeY(dimension, x, z) {
  if (!Number.isFinite(x) || !Number.isFinite(z)) return TELEPORT_CONFIG.DEFAULT_Y;
  const key = `${x | 0},${z | 0}`;
  if (safeYCache.has(key)) return safeYCache.get(key);
  try {
    const block = dimension.getTopmostBlock({ x, z });
    // getTopmostBlock คืน null ถ้า chunk
    // ยังไม่โหลด → ใช้ DEFAULT_Y แต่ไม่ cache
    // เพื่อให้ phase 2 ลอง query ใหม่ได้อีกครั้ง
    if (!block) return TELEPORT_CONFIG.DEFAULT_Y;
    const y = Math.max(TELEPORT_CONFIG.MIN_Y, Math.min(TELEPORT_CONFIG.MAX_Y, block.y + 1));
    if (safeYCache.size >= 256) safeYCache.delete(safeYCache.keys().next().value);
    safeYCache.set(key, y);
    return y;
  } catch {
    return TELEPORT_CONFIG.DEFAULT_Y;
  }
}

// ======================================================
// Groups players by team (จัดกลุ่มผู้เล่นตามทีม)
// ======================================================
function teleportManagerGroupByTeam() {
  const teamMap = new Map();
  const players = world.getPlayers();

  for (let i = 0; i < players.length; i++) {
    const player = players[i];
    if (!player?.isValid) continue;
    if (!player.hasTag("uhc")) continue;

    const tag = getPlayerTeam(player);
    if (!tag) continue;

    if (!teamMap.has(tag)) {
      teamMap.set(tag, []);
    }
    teamMap.get(tag).push(player);
  }
  return teamMap;
}

// ======================================================
// Player Teleport Generate (X,Z)
// ======================================================
function teleportManagerGenerateXZ(teamCount, radius) {
  const effectiveRadius = Math.min(radius, TELEPORT_CONFIG.MAX_SPAWN_RADIUS),
    angleStep = (Math.PI * 2) / teamCount,
    randomOffset = Math.random() * Math.PI * 2,
    positions = [];
  for (let i = 0; i < teamCount; i++) {
    const angle = randomOffset + i * angleStep;
    positions.push({
      x: (center.x + Math.cos(angle) * effectiveRadius) | 0,
      z: (center.z + Math.sin(angle) * effectiveRadius) | 0,
    });
  }
  return positions;
}

// ======================================================
// Player Teleport Queue - Helper Functions
// ======================================================
function createValidTeam(teamData, targetPos, dimension) {
  if (!teamData || !targetPos) return null;

  const members = teamData[1];
  if (!members?.length) return null;

  const snapshot = members.filter((p) => p?.isValid && p.hasTag("uhc"));
  if (!snapshot.length) return null;

  return {
    snapshot,
    capturedX: targetPos.x,
    capturedZ: targetPos.z,
    teamTag: teamData[0],
  };
}

function teleportLeaderToPreload(leader, x, z, dimension, teamTag) {
  try {
    leader.teleport({ x, y: TELEPORT_CONFIG.PRELOAD_Y, z }, { dimension });
    world.sendMessage(`${MinecraftColor.green}[DEBUG] Leader ${leader.name} (${teamTag}) teleported to preload position`);
    return true;
  } catch {
    world.sendMessage(`${MinecraftColor.red}[DEBUG] Leader ${leader.name} (${teamTag}) failed to teleport to preload position`);
    return false;
  }
}

function createMemberQueueEntry(player, loc) {
  return {
    player,
    loc: { ...loc },
    retryCount: 0,
    maxRetries: TELEPORT_CONFIG.MAX_RETRIES,
  };
}

function teleportPlayer(entry, dimension) {
  const { player, loc, retryCount } = entry;

  if (!player?.isValid || !player.hasTag("uhc")) {
    return { success: false, shouldRetry: false };
  }

  try {
    player.teleport(loc, { dimension });
    const role = retryCount > 0 ? `(retry ${retryCount})` : "";
    world.sendMessage(`${MinecraftColor.green}[DEBUG] ${player.name} teleported to final position ${role}`);
    return { success: true, shouldRetry: false };
  } catch {
    const shouldRetry = retryCount < entry.maxRetries;
    if (!shouldRetry) {
      world.sendMessage(`${MinecraftColor.red}[UHC] Failed to teleport ${player.name} after ${entry.maxRetries + 1} attempts`);
    }
    return { success: false, shouldRetry };
  }
}

// ======================================================
// Player Teleport Queue - Main Function
// ======================================================
const teleportQueueAbortHandlers = [];
function teleportManagerRunQueue(teamsData, positions, dimension) {
  let totalOk = 0;
  let totalFail = 0;
  let aborted = false;

  const abort = () => {
    aborted = true;
  };
  teleportQueueAbortHandlers.push(abort);

  function removeAbortHandler() {
    const idx = teleportQueueAbortHandlers.indexOf(abort);
    if (idx !== -1) teleportQueueAbortHandlers.splice(idx, 1);
  }

  function finishQueue() {
    removeAbortHandler();
    const failMsg = totalFail > 0 ? ` ${MinecraftColor.red}fail:${totalFail}` : "";
    world.sendMessage(`[UHC] All teams teleported. ${MinecraftColor.gray}(Queue: ${totalOk}${failMsg}${MinecraftColor.gray})`);
  }

  // * Phase 1: สร้างทีมที่ถูกต้องและรวบรวม
  const validTeams = [];

  for (let i = 0; i < teamsData.length; i++) {
    const validTeam = createValidTeam(teamsData[i], positions[i], dimension);
    if (!validTeam) continue;
    validTeams.push(validTeam);
  }

  if (!validTeams.length) return finishQueue();

  // * Phase 1.5: หน่วงเวลาเทเลพอร์ตผู้นำทีมละ 1 Tick ป้องกัน TPS Spike
  let phase1Idx = 0;
  function processNextLeader() {
    if (aborted) {
      removeAbortHandler();
      return;
    }

    if (phase1Idx >= validTeams.length) {
      // * Phase 2: ดำเนินการคิวสมาชิกหลังจากหน่วงเวลาให้ Leader โหลด Chunk
      system.runTimeout(() => {
        if (aborted) {
          removeAbortHandler();
          return;
        }

        processMemberQueue(
          validTeams,
          dimension,
          finishQueue,
          () => totalOk++,
          () => totalFail++,
          () => aborted,
        );
      }, TELEPORT_CONFIG.LEADER_SETTLE_TICKS);
      return;
    }

    const validTeam = validTeams[phase1Idx++];
    const leader = validTeam.snapshot[0];
    const success = teleportLeaderToPreload(leader, validTeam.capturedX, validTeam.capturedZ, dimension, validTeam.teamTag);

    if (success) totalOk++;
    else totalFail++;

    system.runTimeout(processNextLeader, 1);
  }

  processNextLeader();
}

function processMemberQueue(validTeams, dimension, finishCallback, onSuccess, onFail, isAborted) {
  const memberQueue = [];
  const retryQueue = [];

  // สร้างคิวสมาชิกเริ่มต้น
  for (let t = 0; t < validTeams.length; t++) {
    const { snapshot, capturedX, capturedZ } = validTeams[t];
    const safeY = teleportManagerGetSafeY(dimension, capturedX, capturedZ);
    const loc = { x: capturedX, y: safeY, z: capturedZ };

    for (let m = 0; m < snapshot.length; m++) {
      const player = snapshot[m];
      if (player?.isValid && player.hasTag("uhc")) {
        memberQueue.push(createMemberQueueEntry(player, loc));
      }
    }
  }

  if (memberQueue.length === 0) return finishCallback();

  const totalPlayers = memberQueue.length;
  world.sendMessage(`${MinecraftColor.gray}[DEBUG] Phase 2: Starting teleport queue with ${totalPlayers} players`);

  let qIdx = 0;
  let processedRetries = false;
  let successCount = 0;
  let failCount = 0;

  function processNextMember() {
    if (isAborted()) {
      world.sendMessage(`${MinecraftColor.red}[DEBUG] Teleport queue aborted. Progress: ${qIdx}/${totalPlayers}`);
      return;
    }

    // ตรวจสอบว่าคิวหลักเสร็จสิ้นแล้วหรือไม่ ประมวลผลคิวลองใหม่เพียงครั้งเดียว
    if (qIdx >= memberQueue.length) {
      if (retryQueue.length > 0 && !processedRetries) {
        world.sendMessage(`${MinecraftColor.yellow}[DEBUG] Main queue complete. Processing ${retryQueue.length} retry entries`);
        memberQueue.push(...retryQueue);
        retryQueue.length = 0;
        processedRetries = true;
        world.sendMessage(`${MinecraftColor.cyan}[DEBUG] Retry phase started. Total queue size: ${memberQueue.length}`);
      } else {
        world.sendMessage(
          `${MinecraftColor.green}[DEBUG] All teleports complete. Success: ${successCount}, Failed: ${failCount}, Total: ${totalPlayers}`,
        );
        return finishCallback();
      }
    }

    if (qIdx >= memberQueue.length) return finishCallback();

    const entry = memberQueue[qIdx++];
    const currentNum = qIdx;
    const totalNum = memberQueue.length;

    world.sendMessage(`${MinecraftColor.gray}[DEBUG] Player ${entry.player.name} (${currentNum}/${totalNum})`);

    const result = teleportPlayer(entry, dimension);

    if (result.success) {
      successCount++;
      onSuccess();
      world.sendMessage(`${MinecraftColor.green}[DEBUG] [/] ${entry.player.name} teleported successfully`);
    } else if (result.shouldRetry && !processedRetries) {
      // เพิ่มเข้า retry queue และต่อคิวใหม่
      const retryEntry = { ...entry, retryCount: entry.retryCount + 1 };
      retryQueue.push(retryEntry);

      world.sendMessage(`${MinecraftColor.yellow}[DEBUG] [x] ${entry.player.name} failed, added to retry queue (${retryQueue.length} pending)`);

      if (entry.retryCount === 0) {
        world.sendMessage(
          `${MinecraftColor.yellow}[UHC] Retrying teleport for ${entry.player.name} (attempt ${entry.retryCount + 2}/${entry.maxRetries + 1})`,
        );
      }
    } else {
      failCount++;
      onFail();

      if (result.shouldRetry && processedRetries) {
        world.sendMessage(`${MinecraftColor.red}[DEBUG] [x] ${entry.player.name} final failure - retry phase already completed`);
      } else {
        world.sendMessage(`${MinecraftColor.red}[DEBUG] [x] ${entry.player.name} failed - max attempts reached`);
      }
    }

    // Progress summary ทุก 5 players
    if (currentNum % 5 === 0 || currentNum === totalNum) {
      const phase = processedRetries ? "Retry" : "Main";
      const remaining = totalNum - currentNum;
      world.sendMessage(
        `${MinecraftColor.gray}[DEBUG] ${phase} Progress: ${currentNum}/${totalNum} processed, ${remaining} remaining (/:${successCount} x:${failCount})`,
      );
    }

    // ต่อคิวใหม่เสมอ ไม่หยุดแม้เจอ error
    system.runTimeout(processNextMember, TELEPORT_CONFIG.MEMBER_INTERVAL);
  }

  processNextMember();
}
// =========================================================================================================================
// ==================================== teleport +  Queue ==================================================================
// =========================================================================================================================

// ======================================================
// Main telrport Team
// ======================================================
function teleportManagerTeleportTeam(radius) {
  if (radius === undefined) radius = ctx.borderRadius;
  if (!Number.isFinite(radius)) radius = ctx.borderRadius;

  if (!ctx.cachedDimension) {
    world.sendMessage(MinecraftColor.red + "[UHC] Error: Dimension not initialized");
    return;
  }

  const teamMap = teleportManagerGroupByTeam();
  const teamsData = Array.from(teamMap.entries());

  if (teamsData.length === 0) return;

  world.sendMessage(`${MinecraftColor.gray}[UHC] Spreading ${teamsData.length} teams...`);

  logTeamInfo(teamsData);

  const positions = teleportManagerGenerateXZ(teamsData.length, radius);
  teleportManagerRunQueue(teamsData, positions, ctx.cachedDimension);
}

function logTeamInfo(teamsData) {
  for (let i = 0; i < teamsData.length; i++) {
    const [teamTag, members] = teamsData[i];
    const validMembers = members.filter((p) => p?.isValid && p.hasTag("uhc"));

    if (validMembers.length === 0) {
      world.sendMessage(`${MinecraftColor.gray}[DEBUG] ${teamTag}: 0 valid UHC players`);
      continue;
    }

    const leader = validMembers[0];
    const memberNames = validMembers
      .slice(1)
      .map((p) => p.name)
      .join(", ");
    const memberInfo = memberNames ? `${MinecraftColor.cyan} | Members: ${memberNames}` : "";

    world.sendMessage(
      `${MinecraftColor.gray}[DEBUG] ${teamTag}: ${validMembers.length} players` + `${MinecraftColor.yellow} | Leader: ${leader.name}${memberInfo}`,
    );
  }
}

// ======================================================
// Player spawnParticle
// ======================================================
const explosionLocPool = { x: 0, y: 0, z: 0 };
function playerSetupSpawnParticles(player) {
  if (!player?.isValid || !getPlayerTeam(player)) return;
  const { x, y, z } = player.location;
  if (!player.dimension) return;
  const particleY = y + 2.5;
  if (particleY > 320 || particleY < -64) return;
  try {
    explosionLocPool.x = x;
    explosionLocPool.y = particleY;
    explosionLocPool.z = z;
    player.dimension.spawnParticle("minecraft:huge_explosion_emitter", explosionLocPool);
  } catch {} // @ts-ignore
}

// ======================================================
// Player Setup Handle GameStart (tag uhc)
// ======================================================
const soundOptionsStart = { volume: 0.8, pitch: 1 };
const soundOptionsPlayers = { volume: 1, pitch: 1 };
const soundOptionsExplode = { volume: 0.7, pitch: 0.9 };

function playerSetupHandleGameStart(player, tick) {
  if (tick > 26) return;

  const input = player.inputPermissions;

  switch (tick) {
    case 1:
      player.setGameMode(GameMode.Adventure);
      input?.setPermissionCategory(InputPermissionCategory.Movement, false);
      break;

    case 2:
      player.playSound("start", soundOptionsStart);
      break;

    case 4:
      player.playSound("players", soundOptionsPlayers);
      break;

    case 24:
      player.playSound("startPlayer", soundOptionsStart);
      break;

    case 26:
      input?.setPermissionCategory(InputPermissionCategory.Movement, true);
      player.setGameMode(GameMode.Survival);
      player.removeEffect("invisibility");
      player.onScreenDisplay.setTitle("Good Luck, Have Fun");
      player.playSound("random.explode", soundOptionsExplode);
      playerSetupSpawnParticles(player);
      break;
  }
}

// ======================================================
// Player Display GameStart
// ======================================================
const actionBar = 25;
const actionNum = 5;
const startBars = (() => {
  const prefix = "§fGame Start §l»§r ";
  const bars = new Array(actionBar + 1);
  for (let tick = 0; tick <= actionBar; tick++) {
    const remaining = actionBar - tick;
    const filled = ((tick * actionNum) / actionBar) | 0;
    const empty = actionNum - filled;
    bars[tick] =
      prefix + MinecraftColor.darkAqua + "▌".repeat(filled) + MinecraftColor.gray + "▌".repeat(empty) + MinecraftColor.white + ` ${remaining}`;
  }
  return bars;
})();

// ======================================================
// playerSetupDisplayGameStart (แสดง action bar + เสียงนับถอยหลัง)
// ======================================================
function playerSetupDisplayGameStart(player) {
  const tick = ctx.uhcTick;
  if (tick < 0 || tick > actionBar) return;
  if (!player?.isValid) return;
  const remaining = actionBar - tick,
    playSound = remaining === 20 || remaining === 10 || remaining <= 5;
  player.onScreenDisplay.setActionBar(startBars[tick]);
  if (playSound) player.playSound("note.pling", { volume: 1, pitch: 1 });
}

// ======================================================
// Check Stop gameloop
// ======================================================
function stopGameLoop() {
  if (ctx.checkInterval === null) return;
  system.clearRun(ctx.checkInterval);
  ctx.checkInterval = null;
}

// ======================================================
//
//                   Victory
//
// ======================================================
// victory Check Player and Gameloop
// ======================================================
function victoryManagerTriggerDraw() {
  if (!ctx.isRunning) return;
  ctx.isRunning = false;
  stopGameLoop();
  world.gameRules.pvp = false;
  broadcast(getAllPlayersCached(), { message: "[x]: No Team Survived", sound: "note.pling" });
  victoryManagerStartCountdown();
}

// ======================================================
// victory Countdown
// ======================================================
let countdownRunning = false;
function victoryManagerStartCountdown() {
  if (countdownRunning) return;
  countdownRunning = true;
  let time = 10;
  const id = system.runInterval(() => {
    time--;
    if (time <= 5 && time > 0) world.sendMessage(`${MinecraftColor.red}${icons.Hourglass} Game ending in ${time}`);
    if (time <= 0) {
      system.clearRun(id);
      countdownRunning = false;
      endGameUhc();
    }
  }, 20);
}

// ======================================================
//  victory Dynamic Message
// ======================================================
function victoryManagerTriggerWin(winTag) {
  if (!ctx.isRunning) return;
  ctx.isRunning = false;
  stopGameLoop();
  world.gameRules.pvp = false;

  const teamInfo = getTeamInfo(winTag),
    teamName = teamInfo ? `${teamInfo.color}${teamInfo.name}` : winTag,
    players = getAllPlayersCached();

  for (let i = 0; i < players.length; i++) {
    const p = players[i];
    if (!p?.isValid || getPlayerTeam(p) !== winTag) continue;
    const loc = p.location,
      dim = p.dimension;
    if (loc && dim) {
      explosionLocPool.x = loc.x;
      explosionLocPool.y = loc.y + 2.5;
      explosionLocPool.z = loc.z;
      dim.spawnParticle("minecraft:huge_explosion_emitter", explosionLocPool);
    }
  }

  showVictoryMessage(winTag, ctx.uhcTick);
  broadcast(players, {
    title: MinecraftColor.white + "VICTORY",
    subtitle: `${teamName} Wins`,
    sound: "win",
  });
  victoryManagerStartCountdown();
}

// ======================================================
// victory Check Player (tick = 20 % 60 == 0)
// ======================================================
const aliveTeamsSet = new Set();

function victoryManagerCheck() {
  if (!ctx.isRunning) return;

  const players = getUhcPlayersCached();
  if (!players.length) {
    victoryManagerTriggerDraw();
    return;
  }

  aliveTeamsSet.clear();

  for (let i = 0; i < players.length; i++) {
    const tag = getPlayerTeam(players[i]);
    if (!tag) continue;

    aliveTeamsSet.add(tag);
    if (aliveTeamsSet.size > 1) return;
  }

  if (aliveTeamsSet.size === 1) {
    victoryManagerTriggerWin(aliveTeamsSet.values().next().value);
    return;
  }

  victoryManagerTriggerDraw();
}

// ======================================================
// Dynamic Message
// ======================================================

// Config PVP timing
// uhcTick นับทีละ 1 ต่อ interval (1 interval = 20 game-ticks = 1 วินาที)
// nextShrinkTick = 200 → PVP เปิดหลัง border เริ่มหด 20 วินาที (PVP_DELAY)
const PVP_DELAY = 20; // วินาที
const PVP_TICK = 700 + PVP_DELAY; // = 720
const PVP_WARN = PVP_TICK - 20;
const PVP_CD3 = PVP_TICK - 3;
const PVP_CD2 = PVP_TICK - 2;
const PVP_CD1 = PVP_TICK - 1;

function gameLoopHandleWorldStart(tick, players) {
  if (tick > PVP_TICK + 1 || !players.length) return;

  switch (tick) {
    case 1:
      teleportManagerTeleportTeam();
      break;
    case 24:
      for (let i = 0; i < players.length; i++) {
        if (players[i]?.isValid) playerSetupAddItems(players[i]);
      }
      break;
    case 26:
      world.gameRules.showCoordinates = true;
      world.gameRules.pvp = false;
      world.sendMessage("[UHC] Good Luck, Have Fun");
      break;
    case PVP_WARN:
      broadcast({
        message: dynamicToast(`PVP starts in ${MinecraftColor.red}${PVP_DELAY} ${MinecraftColor.white}s`, "textures/ui/icon_multiplayer"),
        sound: "noti",
      });
      break;
    case PVP_CD3:
    case PVP_CD2:
    case PVP_CD1:
      broadcast({
        message: dynamicToast(`PVP in ${MinecraftColor.red}${PVP_TICK - tick}`),
        sound: "note.pling",
      });
      break;
    case PVP_TICK:
      world.gameRules.pvp = true;
      broadcast({
        message: dynamicToast("PVP enabled!!", "textures/ui/strength_effect"),
        title: icons.Sword,
        subtitle: MinecraftColor.green + "PVP enabled!!",
        sound: "world_noti",
      });
      break;
  }
}

// ======================================================
//            Main GameLoop Display
// ======================================================
const CRITICAL_TICKS = new Set([1, 2, 4, 24, 26]);

function gameLoopPlayersTick(players) {
  if (!players.length || ctx.uhcTick > 26) return;

  const tick = ctx.uhcTick;
  const needsUpdate = CRITICAL_TICKS.has(tick);

  for (let i = 0; i < players.length; i++) {
    const p = players[i];
    if (!p?.isValid) continue;

    if (needsUpdate) playerSetupHandleGameStart(p, tick);
    playerSetupDisplayGameStart(p);
  }
}

// ======================================================
//              Main GameLoop Event
// ======================================================

function gameLoopWorld(uhcPlayers) {
  borderManagerTick();
  borderManagerTickShrink();
  if (ctx.isRunning && ctx.uhcTick <= PVP_TICK) gameLoopHandleWorldStart(ctx.uhcTick, uhcPlayers);
  if (ctx.objective && ctx.uhcTick % 2 === 0) scoreboardUpdate(ctx.objective, uhcPlayers);
  particleRendererTick(uhcPlayers);
}

// ======================================================
//                Main GameLoop System
// ======================================================
function gameLoopRun() {
  ctx.checkInterval = system.runInterval(() => {
    if (!ctx.isRunning) return;
    ctx.uhcTick++;

    if (ctx.uhcTick % 60 === 0) {
      victoryManagerCheck();
    }

    const uhcPlayers = getUhcPlayersCached();
    gameLoopWorld(uhcPlayers);

    if (ctx.uhcTick <= 26) {
      gameLoopPlayersTick(uhcPlayers);
    }
  }, ticks);
}

export function markAliveTeamDirty() {
  ctx.aliveTeamDirty = true;
}

registerAliveTeamDirtyHandler(markAliveTeamDirty);

// ======================================================
//                  start GameUhc
// ======================================================
export function startGameUhc() {
  if (ctx.isRunning) return;

  stopGameLoop();
  initializeGameState();
  setupPlayers();
  gameLoopRun();
}

function initializeGameState() {
  ctx.isRunning = true;
  ctx.fillCommandLocked = false;
  ctx.prevShowCoordinates = world.gameRules.showCoordinates;
  ctx.uhcTick = 0;
  ctx.cachedDimension = world.getDimension("overworld");

  safeYCache.clear();
  abortAllTeleportQueues();

  setGameRunningState(true);
  resetBorderState();
  resetUiState();
  scoreboardInit();
}

function setupPlayers() {
  const players = world.getPlayers();

  playerSetupClearItemsKeepCompass();

  for (let i = 0; i < players.length; i++) {
    playerSetupApplyStartState(players[i]);
  }

  refreshPlayerCaches();
}

function abortAllTeleportQueues() {
  for (let i = 0; i < teleportQueueAbortHandlers.length; i++) {
    teleportQueueAbortHandlers[i]();
  }
  teleportQueueAbortHandlers.length = 0;
}

// ======================================================
//                  End GameUhc
// ======================================================
export function endGameUhc() {
  world.setDifficulty(Difficulty.Peaceful);
  const prevShowCoordinates = ctx.prevShowCoordinates;

  stopGameLoop();
  countdownRunning = false;

  cleanupGameState();
  resetPlayerStates();
  restoreWorldSettings(prevShowCoordinates);
}

function cleanupGameState() {
  abortAllTeleportQueues();
  fillReset();
  endSequenceReset();
  scoreboardClear();
  resetAnnouncer();
  setGameRunningState(false);
  refreshScoreboardUI();
  resetContext(ctx);
}

function resetPlayerStates() {
  const players = world.getPlayers();
  for (let i = 0; i < players.length; i++) {
    playerSetupApplyEndState(players[i]);
  }
}

function restoreWorldSettings(prevShowCoordinates) {
  world.gameRules.showCoordinates = prevShowCoordinates;
  borderManagerSyncGeometry();
}

// ======================================================
//                  Reset GameUhc
// ======================================================
export function resetGameUhc() {
  world.setDifficulty(Difficulty.Peaceful);
  const prevShowCoordinates = ctx.prevShowCoordinates;

  stopGameLoop();
  cleanupResetState();
  resetAllPlayers();
  restoreWorldDefaults(prevShowCoordinates);
  spawnLeaderboardNPC();
}

function cleanupResetState() {
  safeYCache.clear();
  fillReset();
  resetContext(ctx);
  endSequenceReset();
  abortAllTeleportQueues();

  clearAllPlayerNametags();
  setGameRunningState(false);
  scoreboardClear();
  clearAllTaguhcAndDynamicProperty();
  refreshScoreboardUI();
}

function resetAllPlayers() {
  const players = world.getPlayers();

  for (let i = 0; i < players.length; i++) {
    const p = players[i];
    if (!p?.isValid) continue;

    playerSetupClearEffects(p);
    playerSetupApplyEndState(p);
  }

  playerSetupClearItemsKeepCompass();
}

function restoreWorldDefaults(prevShowCoordinates) {
  borderManagerSyncGeometry();
  world.gameRules.pvp = false;
  world.gameRules.showCoordinates = prevShowCoordinates;
}

// ======================================================
// Auto Pause Game Loop on Empty Server (ลดโหลดจากการ Polling)
// ======================================================
world.afterEvents.playerLeave.subscribe(() => {
  system.run(() => {
    if (ctx.isRunning && world.getPlayers().length === 0) {
      stopGameLoop();
    }
  });
});

world.afterEvents.playerSpawn.subscribe(() => {
  if (ctx.isRunning && ctx.checkInterval === null) {
    gameLoopRun();
  }
});
