import { EquipmentSlot, GameMode, InputPermissionCategory, system, world } from "@minecraft/server";

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
  refreshPlayerCaches();
  return getAllPlayers();
}

// ======================================================
// getUhcPlayersCached (ดึงผู้เล่น UHC จากแคช)
// ======================================================
function getUhcPlayersCached() {
  const players = getUhcPlayers();
  if (players.length > 0) return players;
  refreshPlayerCaches();
  return getUhcPlayers();
}

// ======================================================
// Finds a safe Y position for teleporting (หาความสูง (Y) ที่ปลอดภัย สำหรับวาร์ปผู้เล่น)
// ======================================================
const TELEPORT_CONFIG = Object.freeze({
  PRELOAD_Y: 200,
  PRELOAD_DELAY: 2,
  MEMBER_INTERVAL: 3,
  DEFAULT_Y: 120,
  MIN_Y: -64,
  MAX_Y: 320,
  MAX_SPAWN_RADIUS: 490,
});

function teleportManagerGetSafeY(dimension, x, z) {
  if (!Number.isFinite(x) || !Number.isFinite(z)) return TELEPORT_CONFIG.DEFAULT_Y;
  const key = `${x | 0},${z | 0}`;
  if (safeYCache.has(key)) return safeYCache.get(key);
  try {
    const block = dimension.getTopmostBlock({ x, z });
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
  const teamMap = new Map(),
    players = getUhcPlayersCached();
  for (let i = 0; i < players.length; i++) {
    const player = players[i];
    if (!player?.isValid) continue;
    const tag = getPlayerTeam(player);
    if (!tag) continue;
    let team = teamMap.get(tag);
    if (!team) {
      team = [];
      teamMap.set(tag, team);
    }
    team.push(player);
  }
  return teamMap;
}

// ======================================================
// Player Teleport Generate (X,Z)
// ======================================================
const positionsPool = [];
function teleportManagerGenerateXZ(teamCount, radius) {
  const effectiveRadius = Math.min(radius, TELEPORT_CONFIG.MAX_SPAWN_RADIUS),
    angleStep = (Math.PI * 2) / teamCount,
    randomOffset = Math.random() * Math.PI * 2;
  for (let i = 0; i < teamCount; i++) {
    const angle = randomOffset + i * angleStep;
    let pos = positionsPool[i];
    if (!pos) {
      pos = { x: 0, z: 0 };
      positionsPool[i] = pos;
    }
    pos.x = (center.x + Math.cos(angle) * effectiveRadius) | 0;
    pos.z = (center.z + Math.sin(angle) * effectiveRadius) | 0;
  }
  positionsPool.length = teamCount;
  return positionsPool;
}

// ======================================================
// Player Teleport Queue
// ======================================================
const teleportLocLeader = { x: 0, y: 0, z: 0 };
const teleportQueueAbortHandlers = [];
function teleportManagerRunQueue(teamsData, positions, dimension) {
  let teamIdx = 0,
    totalOk = 0,
    totalFail = 0,
    aborted = false;

  const abort = () => {
    aborted = true;
  };
  teleportQueueAbortHandlers.push(abort);

  function removeAbortHandler() {
    const index = teleportQueueAbortHandlers.indexOf(abort);
    if (index !== -1) teleportQueueAbortHandlers.splice(index, 1);
  }

  function finishQueue() {
    removeAbortHandler();
    world.sendMessage(
      `[UHC] All teams teleported. ${MinecraftColor.gray}(OK:${totalOk}` +
        (totalFail > 0 ? ` ${MinecraftColor.red}fail:${totalFail}` : "") +
        `${MinecraftColor.gray})`,
    );
  }

  function nextTeam() {
    if (aborted) {
      removeAbortHandler();
      return;
    }
    if (teamIdx >= teamsData.length) return finishQueue();

    const teamData = teamsData[teamIdx];
    const targetPos = positions[teamIdx];
    teamIdx++;

    if (!teamData || !targetPos) return nextTeam();

    const members = teamData[1];
    if (!members?.length) return nextTeam();

    const snapshot = [];
    for (let i = 0; i < members.length; i++) {
      if (members[i]?.isValid) snapshot.push(members[i]);
    }
    if (!snapshot.length) return nextTeam();

    const capturedX = targetPos.x;
    const capturedZ = targetPos.z;

    const leader = snapshot[0];
    try {
      teleportLocLeader.x = capturedX;
      teleportLocLeader.y = TELEPORT_CONFIG.PRELOAD_Y;
      teleportLocLeader.z = capturedZ;
      leader.teleport(teleportLocLeader, { dimension });
    } catch {
      return nextTeam();
    }

    system.runTimeout(() => {
      if (aborted) return;

      const safeY = teleportManagerGetSafeY(dimension, capturedX, capturedZ);
      const loc = { x: capturedX, y: safeY, z: capturedZ };

      let mIdx = 0;

      function nextMember() {
        if (aborted) return;
        if (mIdx >= snapshot.length) return nextTeam();

        const p = snapshot[mIdx++];
        if (!p?.isValid) {
          totalFail++;
          return system.runTimeout(nextMember, TELEPORT_CONFIG.MEMBER_INTERVAL);
        }
        try {
          p.teleport(loc, { dimension });
          totalOk++;
        } catch {
          totalFail++;
        }
        system.runTimeout(nextMember, TELEPORT_CONFIG.MEMBER_INTERVAL);
      }

      nextMember();
    }, TELEPORT_CONFIG.PRELOAD_DELAY);
  }

  nextTeam();
}

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
  const teamMap = teleportManagerGroupByTeam(),
    teamsData = Array.from(teamMap.entries());
  if (teamsData.length === 0) return;
  world.sendMessage(`${MinecraftColor.gray}[UHC] Spreading ${teamsData.length} teams...`);
  const positions = teleportManagerGenerateXZ(teamsData.length, radius);
  teleportManagerRunQueue(teamsData, positions, ctx.cachedDimension);
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
  } catch {}
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
//  victory Check Player (tick = 20 % 60 == 0)
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
// nextShrinkTick = 300 → PVP เปิดหลัง border เริ่มหด 20 วินาที (PVP_DELAY)
const PVP_DELAY = 20; // วินาที
const PVP_TICK = 400 + PVP_DELAY; // uhcTick ที่ pvp เปิด (420)
const PVP_WARN = PVP_TICK - 20; // แจ้งก่อน 20 วินาที
const PVP_CD3 = PVP_TICK - 3;
const PVP_CD2 = PVP_TICK - 2;

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
        message: dynamicToast(`PVP starts in ${MinecraftColor.red}${PVP_DELAY} ${MinecraftColor.white}seconds`, "textures/ui/icon_multiplayer"),
        sound: "noti",
      });
      break;
    case PVP_CD3:
    case PVP_CD2:
      broadcast({
        message: dynamicToast(`PVP in ${MinecraftColor.red}${PVP_TICK - tick}`, "textures/ui/strength_effect"),
        sound: "note.pling",
      });
      break;
    case PVP_TICK:
      world.gameRules.pvp = true;
      broadcast({
        message: dynamicToast("PVP enabled!!", "textures/ui/icon_steve"),
        title: icons.Sword,
        subtitle: MinecraftColor.green + "PVP enabled!!",
        sound: "world_noti",
      });
      break;
  }
}

// ======================================================
// Main GameLoop Display
// ======================================================
const CRITICAL_TICKS = new Set([1, 2, 4, 24, 26]);
function gameLoopPlayersTick(players) {
  if (!players.length || ctx.uhcTick > 26) return;
  const tick = ctx.uhcTick,
    needsUpdate = CRITICAL_TICKS.has(tick);
  for (let i = 0; i < players.length; i++) {
    const p = players[i];
    if (!p?.isValid) continue;
    if (needsUpdate) playerSetupHandleGameStart(p, tick);
    playerSetupDisplayGameStart(p);
  }
}

// ======================================================
// Main GameLoop Event
// ======================================================

function gameLoopWorld(uhcPlayers) {
  borderManagerTick();
  borderManagerTickShrink();
  if (ctx.isRunning && ctx.uhcTick <= PVP_TICK) gameLoopHandleWorldStart(ctx.uhcTick, uhcPlayers);
  if (ctx.objective && ctx.uhcTick % 2 === 0) scoreboardUpdate(ctx.objective, uhcPlayers);
  particleRendererTick(uhcPlayers);
}

// ======================================================
// Main GameLoop System
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
//
//                  start GameUhc
//
// ======================================================
export function startGameUhc() {
  if (ctx.isRunning) return;
  stopGameLoop();
  ctx.isRunning = true;
  ctx.fillCommandLocked = false;
  ctx.prevShowCoordinates = world.gameRules.showCoordinates;
  setGameRunningState(true);
  ctx.uhcTick = 0;
  ctx.cachedDimension = world.getDimension("overworld");

  safeYCache.clear();

  for (let i = 0; i < teleportQueueAbortHandlers.length; i++) {
    teleportQueueAbortHandlers[i]();
  }

  teleportQueueAbortHandlers.length = 0;

  resetBorderState();
  resetUiState();
  scoreboardInit();

  const players = world.getPlayers();

  for (let i = 0; i < players.length; i++) {
    playerSetupApplyStartState(players[i]);
  }

  refreshPlayerCaches();
  gameLoopRun();
  playerSetupClearItemsKeepCompass();
}

// ======================================================
//
//                  End GameUhc
//
// ======================================================

export function endGameUhc() {
  const prevShowCoordinates = ctx.prevShowCoordinates;
  stopGameLoop();
  countdownRunning = false;

  fillReset();
  endSequenceReset();

  const players = world.getPlayers();
  for (let i = 0; i < players.length; i++) {
    playerSetupApplyEndState(players[i]);
  }

  scoreboardClear();
  resetAnnouncer();
  setGameRunningState(false);
  refreshScoreboardUI();

  resetContext(ctx);
  world.gameRules.showCoordinates = prevShowCoordinates;
  borderManagerSyncGeometry();
}

// ======================================================
//
//                  Reset GameUhc
//
// ======================================================

export function resetGameUhc() {
  const prevShowCoordinates = ctx.prevShowCoordinates;
  stopGameLoop();

  fillReset();
  resetContext(ctx);
  endSequenceReset();

  for (let i = 0; i < teleportQueueAbortHandlers.length; i++) {
    teleportQueueAbortHandlers[i]();
  }

  teleportQueueAbortHandlers.length = 0;

  clearAllPlayerNametags();
  borderManagerSyncGeometry();
  world.gameRules.pvp = false;
  world.gameRules.showCoordinates = prevShowCoordinates;

  setGameRunningState(false);
  scoreboardClear();
  clearAllTaguhcAndDynamicProperty();
  refreshScoreboardUI();

  const players = world.getPlayers();
  for (let i = 0; i < players.length; i++) {
    const p = players[i];
    if (!p?.isValid) continue;
    playerSetupClearEffects(p);
    playerSetupApplyEndState(p);
  }

  playerSetupClearItemsKeepCompass();
  spawnLeaderboardNPC();
}
