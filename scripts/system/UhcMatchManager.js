import { EquipmentSlot, GameMode, InputPermissionCategory, ItemStack, system, world } from "@minecraft/server";

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
  resetAnnouncerSystem,
  setGameRunningState,
  showVictoryMessage,
} from "../Manager/TeamManager.js";

// @ts-ignore
import { spawnLeaderboardNPC } from "../Manager/Leaderboard.js";

// @ts-ignore
import { dynamicToast } from "../plugin/Util.js";

import { fillReset } from "./BlockFiller.js";
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

const TELEPORT_CONFIG = Object.freeze({
  PRELOAD_Y: 200,
  PRELOAD_DELAY: 20,
  MEMBER_INTERVAL: 3,
  DEFAULT_Y: 120,
  MIN_Y: -64,
  MAX_Y: 320,
  MAX_SPAWN_RADIUS: 490,
});

const PVP_DELAY = 20; // วินาทีหลัง border เริ่มลดลง
const PVP_TICK = 300 + PVP_DELAY * 20; // tick ที่ pvp เปิด
const PVP_WARN = PVP_TICK - 400; // ประกาศก่อน 20 วินาที
const PVP_CD3 = PVP_TICK - 60; // นับถอยหลัง 3
const PVP_CD2 = PVP_TICK - 40; // นับถอยหลัง 2

const positionsPool = [],
  validMembersPool = [],
  finalLocationPool = { x: 0, y: 0, z: 0 },
  teleportLocLeader = { x: 0, y: 0, z: 0 },
  effectOptionsSlowFalling = { amplifier: 255, showParticles: false };

const safeYCache = new Map();

const explosionLocPool = { x: 0, y: 0, z: 0 },
  effectOptionsHidden = { amplifier: 255, showParticles: false },
  soundOptionsStart = { volume: 0.8, pitch: 1 },
  soundOptionsPlayers = { volume: 1, pitch: 1 },
  soundOptionsExplode = { volume: 0.7, pitch: 0.9 },
  soundOptionsPling = { volume: 1, pitch: 1 };

const UHC_EFFECTS = ["regeneration", "blindness", "invisibility", "resistance", "conduit_power", "slow_falling"];
const aliveTeamsSet = new Set();
const CRITICAL_TICKS = new Set([1, 2, 4, 24, 26]);
const UHC_PLAYER_EFFECTS = [
  ["regeneration", 520],
  ["blindness", 520],
  ["invisibility", 1200],
  ["resistance", 1200],
];

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

function teleportManagerGroupByTeam() {
  const teamMap = new Map(),
    players = getUhcPlayers();
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

function teleportManagerRunQueue(teamsData, positions, dimension) {
  let teamIdx = 0,
    totalOk = 0,
    totalFail = 0,
    aborted = false;

  const abort = () => {
    aborted = true;
  };
  const abortHandlers = teleportManagerRunQueue._abortHandlers ?? (teleportManagerRunQueue._abortHandlers = []);
  abortHandlers.push(abort);

  function nextTeam() {
    if (aborted) return;
    if (teamIdx >= teamsData.length) {
      world.sendMessage(
        `[UHC] All teams teleported. ${MinecraftColor.gray}(T${totalOk}${totalFail > 0 ? ` ${MinecraftColor.red}fail:${totalFail}` : MinecraftColor.gray})`,
      );
      return;
    }
    const [, members] = teamsData[teamIdx],
      targetPos = positions[teamIdx];
    teamIdx++;
    if (!members?.length || !targetPos) return nextTeam();

    validMembersPool.length = 0;
    for (let i = 0; i < members.length; i++) {
      if (members[i]?.isValid) validMembersPool.push(members[i]);
    }
    if (!validMembersPool.length) return nextTeam();

    const leader = validMembersPool[0];
    try {
      teleportLocLeader.x = targetPos.x;
      teleportLocLeader.y = TELEPORT_CONFIG.PRELOAD_Y;
      teleportLocLeader.z = targetPos.z;
      leader.teleport(teleportLocLeader, { dimension });
      leader.addEffect("slow_falling", TELEPORT_CONFIG.PRELOAD_DELAY + 20, effectOptionsSlowFalling);
    } catch {
      return nextTeam();
    }

    system.runTimeout(() => {
      finalLocationPool.x = targetPos.x;
      finalLocationPool.y = teleportManagerGetSafeY(dimension, targetPos.x, targetPos.z);
      finalLocationPool.z = targetPos.z;
      let mIdx = 0;
      const delay = TELEPORT_CONFIG.MEMBER_INTERVAL;

      function nextMember() {
        if (aborted) return;
        if (mIdx >= validMembersPool.length) return nextTeam();
        const p = validMembersPool[mIdx++];
        if (!p?.isValid) {
          totalFail++;
          return system.runTimeout(nextMember, delay);
        }
        try {
          p.teleport(finalLocationPool, { dimension });
          totalOk++;
        } catch {
          totalFail++;
        }
        system.runTimeout(nextMember, delay);
      }

      nextMember();
    }, TELEPORT_CONFIG.PRELOAD_DELAY);
  }

  nextTeam();
}

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

function playerSetupAddItems(player) {
  if (!player?.isValid) return;
  const inv = player.getComponent("minecraft:inventory")?.container;
  if (!inv) return;
  inv.addItem(new ItemStack("minecraft:stone_axe", 1));
  inv.addItem(new ItemStack("minecraft:stone_pickaxe", 1));
  inv.addItem(new ItemStack("minecraft:cooked_beef", 3));
  inv.addItem(new ItemStack("minecraft:oak_boat", 1));
}

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

function playerSetupDisplayGameStart(player) {
  const tick = ctx.uhcTick;
  if (tick < 0 || tick > actionBar) return;
  if (!player?.isValid) return;
  const remaining = actionBar - tick,
    playSound = remaining === 20 || remaining === 10 || remaining <= 5;
  player.onScreenDisplay.setActionBar(startBars[tick]);
  if (playSound) player.playSound("note.pling", soundOptionsPling);
}

function playerSetupClearEffects(player) {
  if (!player?.isValid) return;
  for (let i = 0; i < UHC_EFFECTS.length; i++) player.removeEffect(UHC_EFFECTS[i]);
}

function playerSetupClearItemsKeepCompass() {
  const players = world.getPlayers();
  const total = players.length;
  if (total === 0) return;

  const token = { cancelled: false };
  playerSetupClearItemsKeepCompass._token = token;

  const BATCH = 3;
  let offset = 0;

  const run = () => {
    if (token.cancelled) return;
    const end = Math.min(offset + BATCH, total);
    for (let i = offset; i < end; i++) {
      const p = players[i];
      if (!p?.isValid) continue;
      const inv = p.getComponent("minecraft:inventory")?.container;
      if (!inv) continue;
      let compassSlot = -1;
      for (let slot = 0; slot < inv.size; slot++) {
        const item = inv.getItem(slot);
        if (!item) continue;
        if (item.typeId === "minecraft:compass") {
          if (compassSlot === -1) {
            compassSlot = slot;
            if (item.amount !== 1) {
              item.amount = 1;
              inv.setItem(slot, item);
            }
          } else {
            inv.setItem(slot);
          }
        } else {
          inv.setItem(slot);
        }
      }
      const equip = p.getComponent("minecraft:equippable");
      if (!equip) continue;
      equip.setEquipment(EquipmentSlot.Offhand, undefined);
      equip.setEquipment(EquipmentSlot.Head, undefined);
      equip.setEquipment(EquipmentSlot.Chest, undefined);
      equip.setEquipment(EquipmentSlot.Legs, undefined);
      equip.setEquipment(EquipmentSlot.Feet, undefined);
    }
    offset += BATCH;
    if (offset < total) system.runTimeout(run, 1);
  };

  run();
}

function stopGameLoop() {
  if (ctx.checkInterval === null) return;
  system.clearRun(ctx.checkInterval);
  ctx.checkInterval = null;
}

function playerSetupApplyStartState(player) {
  if (!player?.isValid) return;
  if (getPlayerTeam(player)) {
    player.addTag("uhc");
    for (let i = 0; i < UHC_PLAYER_EFFECTS.length; i++) {
      const [effect, duration] = UHC_PLAYER_EFFECTS[i];
      player.addEffect(effect, duration, effectOptionsHidden);
    }
    return;
  }
  player.setGameMode(GameMode.Spectator);
  player.addEffect("conduit_power", 1, effectOptionsHidden);
}

function playerSetupApplyEndState(player) {
  if (!player?.isValid) return;
  if (getPlayerTeam(player)) {
    player.removeTag("uhc");
    player.addEffect("regeneration", 520, effectOptionsHidden);
    return;
  }
  player.setGameMode(GameMode.Adventure);
  player.removeEffect("conduit_power");
}

function victoryManagerTriggerDraw() {
  if (!ctx.isRunning) return;
  ctx.isRunning = false;
  if (ctx.checkInterval !== null) {
    system.clearRun(ctx.checkInterval);
    ctx.checkInterval = null;
  }
  world.gameRules.pvp = false;
  broadcast(getAllPlayers(), { message: "[x]: No Team Survived", sound: "note.pling" });
  victoryManagerStartCountdown();
}

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

function victoryManagerTriggerWin(winTag) {
  if (!ctx.isRunning) return;
  ctx.isRunning = false;
  if (ctx.checkInterval !== null) {
    system.clearRun(ctx.checkInterval);
    ctx.checkInterval = null;
  }
  world.gameRules.pvp = false;

  const teamInfo = getTeamInfo(winTag),
    teamName = teamInfo ? `${teamInfo.color}${teamInfo.name}` : winTag,
    players = getAllPlayers();

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

function victoryManagerCheck() {
  if (!ctx.isRunning) return;
  const players = getUhcPlayers();
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
        message: dynamicToast(`PVP starts in ${MinecraftColor.red}}${PVP_DELAY} ${MinecraftColor.white}seconds`, "textures/ui/icon_multiplayer"),
        sound: "noti",
      });
      break;
    case PVP_CD3:
    case PVP_CD2:
      broadcast({ message: dynamicToast(`PVP in ${MinecraftColor.red}${PVP_TICK - tick}`, "textures/ui/strength_effect"), sound: "note.pling" });
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

function gameLoopWorldTick(uhcPlayers) {
  borderManagerTick();
  borderManagerTickShrink();
  if (ctx.isRunning && ctx.uhcTick <= PVP_TICK) gameLoopHandleWorldStart(ctx.uhcTick, uhcPlayers);
  if (ctx.objective && ctx.uhcTick % 2 === 0) scoreboardUpdate(ctx.objective, uhcPlayers);
  particleRendererTick(uhcPlayers);
}

function gameLoopRun() {
  ctx.checkInterval = system.runInterval(() => {
    if (!ctx.isRunning) return;
    ctx.uhcTick++;
    if (ctx.uhcTick % 120 === 0) victoryManagerCheck();
    const uhcPlayers = getUhcPlayers();
    gameLoopWorldTick(uhcPlayers);
    if (ctx.uhcTick <= 26) gameLoopPlayersTick(getAllPlayers());
  }, ticks);
}

export function markAliveTeamDirty() {
  ctx.aliveTeamDirty = true;
}

registerAliveTeamDirtyHandler(markAliveTeamDirty);

export function startGameUhc() {
  if (ctx.isRunning) return;
  stopGameLoop();
  ctx.isRunning = true;
  ctx.fillCommandLocked = false;
  ctx.prevShowCoordinates = world.gameRules.showCoordinates;
  setGameRunningState(true);
  ctx.uhcTick = 0;
  ctx.cachedDimension = world.getDimension("overworld");

  const players = world.getPlayers();
  const total = players.length;
  let idx = 0;
  function applyBatch() {
    const end = Math.min(idx + 5, total);
    for (; idx < end; idx++) playerSetupApplyStartState(players[idx]);
    if (idx < total) system.runTimeout(applyBatch, 1);
  }
  applyBatch();

  refreshPlayerCaches();
  safeYCache.clear();
  if (teleportManagerRunQueue._abortHandlers) {
    teleportManagerRunQueue._abortHandlers.forEach((fn) => fn());
    teleportManagerRunQueue._abortHandlers = [];
  }

  if (playerSetupClearItemsKeepCompass._token) {
    playerSetupClearItemsKeepCompass._token.cancelled = true;
  }
  resetBorderState();
  resetUiState();
  scoreboardInit();
  gameLoopRun();
  playerSetupClearItemsKeepCompass();
}

export function endGameUhc() {
  const prevShowCoordinates = ctx.prevShowCoordinates;
  stopGameLoop();
  countdownRunning = false;

  if (playerSetupClearItemsKeepCompass._token) {
    playerSetupClearItemsKeepCompass._token.cancelled = true;
  }

  fillReset();
  endSequenceReset();

  const players = world.getPlayers();
  for (let i = 0; i < players.length; i++) {
    playerSetupApplyEndState(players[i]);
  }

  scoreboardClear();
  resetAnnouncerSystem();
  setGameRunningState(false);
  refreshScoreboardUI();

  resetContext(ctx);
  world.gameRules.showCoordinates = prevShowCoordinates;
  borderManagerSyncGeometry();
}

export function resetGameUhc() {
  const prevShowCoordinates = ctx.prevShowCoordinates;
  stopGameLoop();

  fillReset();
  resetContext(ctx);
  endSequenceReset();
  if (teleportManagerRunQueue._abortHandlers) {
    teleportManagerRunQueue._abortHandlers.forEach((fn) => fn());
    teleportManagerRunQueue._abortHandlers = [];
  }

  if (playerSetupClearItemsKeepCompass._token) {
    playerSetupClearItemsKeepCompass._token.cancelled = true;
  }

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
