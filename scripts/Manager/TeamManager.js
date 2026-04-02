import { world, system, DisplaySlotId, GameMode } from "@minecraft/server";
import { ActionFormData } from "@minecraft/server-ui";
// @ts-ignore
import { dynamicToast } from "../plugin/Util.js";

// ======================================================
// Player Cache (cache ผู้เล่น runtime)
// ======================================================
let allPlayersCache = [];
let uhcPlayersCache = [];
let allPlayersCacheIds = new Set();

// ======================================================
// Alive Team Dirty Handler (callback เมื่อ team เปลี่ยน)
// ======================================================
let aliveTeamDirtyHandler = () => {};

// ======================================================
// registerAliveTeamDirtyHandler (register callback)
// ======================================================
export function registerAliveTeamDirtyHandler(handler) {
  aliveTeamDirtyHandler = typeof handler === "function" ? handler : () => {};
}

// ======================================================
// TEAMS (config ทีมทั้งหมด)
// ======================================================
const TEAMS = Object.freeze([
  { id: "team1", name: "Red", color: "§c", icon: "textures/items/dye_powder_red" },
  { id: "team2", name: "Blue", color: "§9", icon: "textures/items/dye_powder_blue_new" },
  { id: "team3", name: "Yellow", color: "§e", icon: "textures/items/dye_powder_yellow" },
  { id: "team4", name: "Green", color: "§a", icon: "textures/items/dye_powder_lime" },
  { id: "team5", name: "Purple", color: "§5", icon: "textures/items/dye_powder_purple" },
  { id: "team6", name: "Aqua", color: "§b", icon: "textures/items/dye_powder_light_blue" },
  { id: "team7", name: "Orange", color: "§6", icon: "textures/items/dye_powder_orange" },
  { id: "team8", name: "Gray", color: "§7", icon: "textures/items/dye_powder_silver" },
  { id: "team9", name: "Pink", color: "§d", icon: "textures/items/dye_powder_pink" },
]);

// ======================================================
// CONFIG (ค่าคงที่ระบบ UHC)
// ======================================================
export const CONFIG = Object.freeze({
  adminTag: "admin",
  uhcTag: "uhc",
  objectiveName: "uhcBoard",
  displayName: "UHC",
  title: "§g§r",

  // DynamicProperty:
  // { playerId → teamId }
  key: "team",
});

// ======================================================
// TEAM_LOOKUP (map id → team info)
// ======================================================
const TEAM_LOOKUP = new Map(TEAMS.map((t) => [t.id, t]));

// ======================================================
// TEAM_INDEX_MAP (map id → index)
// ======================================================
const TEAM_INDEX_MAP = new Map(TEAMS.map((t, i) => [t.id, i]));

// ======================================================
// Team Runtime State (count + player index)
// ======================================================
const teamCounts = new Map(); // teamId → จำนวนผู้เล่น
const teamPlayerIndex = new Map(); // teamId → Set(playerId)

for (const t of TEAMS) {
  teamPlayerIndex.set(t.id, new Set());
}

for (const t of TEAMS) {
  teamCounts.set(t.id, 0);
}

// ======================================================
// Scoreboard State
// ======================================================
let isGameRunning = false;
let cachedBoard;
let sidebarFlushTask = null;
const dirtySidebarTeams = new Set();

// ======================================================
// KD Config (ระบบ Kill / Death)
// ======================================================
const KD = Object.freeze({
  SCORE_HISTORY_OBJECTIVE: "kdhistory",
  HIT_TIMEOUT_SECONDS: 8,
});

// ======================================================
// Runtime Stats / Config ค่าคงที่ + state สำหรับ UHC runtime
// ======================================================
const HIT_TIMEOUT_TICKS = 20 * KD.HIT_TIMEOUT_SECONDS;
const MULTI_TIMEOUT_TICKS = 20 * 16;

// { teamId -> { kills, deaths } }
const teamStats = new Map();

// { playerId -> { kills, deaths, name, teamId } }
const playerStats = new Map();

// { playerId -> { x, y, z } }
const deathLocation = new Map();
const teamsLen = TEAMS.length;

const playerTeamCache = createCacheProxy("teamId");
const hitRegistry = createCacheProxy("hit");
const multiKill = createCacheProxy("multiKill");
const killStreak = createCacheProxy("killStreak");
const playerCache = createCacheProxy("playerRef");

// ======================================================
// refreshScoreboardUI (force update sidebar ทั้งหมด)
// ======================================================
export function refreshScoreboardUI() {
  if (isGameRunning) return;
  const board = getBoard();
  world.scoreboard.setObjectiveAtDisplaySlot(DisplaySlotId.Sidebar, { objective: board });
  const teamsLen = TEAMS.length;

  for (let i = 0; i < teamsLen; i++) {
    dirtySidebarTeams.add(TEAMS[i].id);
  }
  flushSidebarUpdates();
}

// ======================================================
// getBoard (get/create scoreboard + cache)
// ======================================================
function getBoard() {
  if (cachedBoard) {
    const obj = world.scoreboard.getObjective(CONFIG.objectiveName);
    if (obj) return obj;
    cachedBoard = null;
  }

  let board = world.scoreboard.getObjective(CONFIG.objectiveName);
  if (!board) {
    board = world.scoreboard.addObjective(CONFIG.objectiveName, CONFIG.displayName);
  }

  cachedBoard = board;
  return board;
}

// ======================================================
// flushSidebarUpdates (apply update จาก dirty set)
// ======================================================
function flushSidebarUpdates() {
  if (isGameRunning) return;

  const board = getBoard();
  for (const teamId of dirtySidebarTeams) {
    const team = TEAM_LOOKUP.get(teamId);
    if (!team) continue;

    const entry = `${team.color}${team.name}`,
      count = teamCounts.get(teamId) ?? 0;

    if (count <= 0) {
      try {
        board.removeParticipant(entry);
      } catch (error) {
        console.error("[Board Remove Participant]: " + error);
      }
    } else {
      board.setScore(entry, count);
    }
  }

  dirtySidebarTeams.clear();
}

// ======================================================
// updateSidebar (mark team + schedule batch update)
// ======================================================
function updateSidebar(teamId) {
  if (isGameRunning || !TEAM_LOOKUP.has(teamId)) return;

  dirtySidebarTeams.add(teamId);
  if (sidebarFlushTask !== null) return;

  sidebarFlushTask = system.runTimeout(() => {
    sidebarFlushTask = null;
    flushSidebarUpdates();
  }, 1);
}

// ======================================================
// setTeam (กำหนดทีม + sync state ทั้งหมด)
// ======================================================
function setTeam(player, teamId) {
  if (!player?.id) return;
  const oldTeamId = playerTeamCache.get(player.id) ?? null;
  if (oldTeamId === teamId) return;
  const shouldTrack = !isGameRunning || player?.hasTag("uhc");

  // remove จากทีมเก่า
  if (oldTeamId && shouldTrack) {
    teamPlayerIndex.get(oldTeamId)?.delete(player.id);
  }

  // set ทีมใหม่
  if (teamId) {
    player.setDynamicProperty(CONFIG.key, teamId);
    playerTeamCache.set(player.id, teamId);
    if (shouldTrack) {
      teamPlayerIndex.get(teamId)?.add(player.id);
    }

    const teamIndex = (TEAM_INDEX_MAP.get(teamId) ?? -1) + 1;
    const teamInfo = TEAM_LOOKUP.get(teamId);
    if (teamInfo) {
      player.nameTag = `[${teamIndex}] ${teamInfo.color}${player.name}`;
    }

    const ps = playerStats.get(player.id) ?? { kills: 0, deaths: 0 };
    ps.name = player.name;
    ps.teamId = teamId;
    playerStats.set(player.id, ps);

    scheduleSaveStats();
  } else {
    player.setDynamicProperty(CONFIG.key, null);
    playerTeamCache.delete(player.id);
    player.nameTag = player.name;
  }

  syncTag(player, oldTeamId, teamId ?? null);
  aliveTeamDirtyHandler();
}
// ======================================================
// Remove Cached Player By Id (ลบ player จาก array ด้วย swap-pop)
// ======================================================
function removeCachedPlayerById(list, id) {
  if (!list || list.length === 0) return;
  let index = -1;
  for (let i = 0; i < list.length; i++) {
    if (list[i].id === id) {
      index = i;
      break;
    }
  }
  if (index === -1) return;
  const lastIndex = list.length - 1;
  if (index !== lastIndex) {
    list[index] = list[lastIndex];
  }
  list.pop();
}

// ======================================================
// Remove Player From Alive Runtime State (ลบ player จาก runtime UHC)
// ======================================================
function removePlayerFromAliveRuntimeState(id, teamId) {
  if (!id) return;
  const resolvedTeamId = teamId ?? playerTeamCache.get(id) ?? null;
  uhcPlayerIds.delete(id);
  removeCachedPlayerById(uhcPlayersCache, id);
  if (!resolvedTeamId || !TEAM_LOOKUP.has(resolvedTeamId)) {
    aliveTeamDirtyHandler();
    return;
  }
  const count = teamCounts.get(resolvedTeamId) ?? 0;
  teamCounts.set(resolvedTeamId, count > 0 ? count - 1 : 0);
  teamPlayerIndex.get(resolvedTeamId)?.delete(id);
  updateSidebar(resolvedTeamId);
  aliveTeamDirtyHandler();
}

// ======================================================
// syncTag (sync tag ทีมของ player)
// ======================================================
function syncTag(player, oldTeamId, newTeamId) {
  if (oldTeamId === newTeamId) return;

  if (player.hasTag(oldTeamId)) {
    player.removeTag(oldTeamId);
  }

  if (!newTeamId) return;

  if (!player.hasTag(newTeamId)) {
    player.addTag(newTeamId);
  }
}

// ======================================================
// joinTeam (ย้ายทีม + sync runtime + sidebar)
// ======================================================
function joinTeam(player, newTeamId) {
  if (!TEAM_LOOKUP.has(newTeamId)) return;

  const oldTeam = getPlayerTeam(player);
  if (oldTeam === newTeamId) return;

  const shouldTrack = !isGameRunning || player?.hasTag("uhc");

  if (shouldTrack && oldTeam) {
    const oldCount = teamCounts.get(oldTeam) ?? 0;
    teamCounts.set(oldTeam, oldCount > 0 ? oldCount - 1 : 0);
  }

  if (shouldTrack) {
    const newCount = teamCounts.get(newTeamId) ?? 0;
    teamCounts.set(newTeamId, newCount + 1);
  }

  setTeam(player, newTeamId);

  if (shouldTrack) {
    if (oldTeam) updateSidebar(oldTeam);
    updateSidebar(newTeamId);
  }
}

// ======================================================
// leaveTeam (ออกจากทีม + sync runtime + sidebar)
// ======================================================
function leaveTeam(player) {
  const oldTeam = getPlayerTeam(player);
  if (!oldTeam) return;
  const shouldTrack = !isGameRunning || player?.hasTag("uhc");
  if (shouldTrack) {
    const current = teamCounts.get(oldTeam) ?? 0;
    teamCounts.set(oldTeam, current > 0 ? current - 1 : 0);
  }
  setTeam(player, null);
  if (shouldTrack) {
    updateSidebar(oldTeam);
  }
}

// ======================================================
// Get Killer Display (แปลง killer เป็นชื่อแสดงผล รวมสีทีม)
// ======================================================
function getKillerDisplay(player) {
  const resolvedKiller = resolveKiller(player.id);
  if (!resolvedKiller?.isValid) {
    return getEnvironmentDeath(player.id);
  }

  const teamId = playerTeamCache.get(resolvedKiller.id);
  if (!teamId) return resolvedKiller.name;

  const team = TEAM_LOOKUP.get(teamId);
  if (!team) return resolvedKiller.name;

  return `${team.color}${resolvedKiller.name}§r`;
}

// ======================================================
// Get Environment Death (คืนค่าประเภทการตายจาก environment)
// ======================================================
function getEnvironmentDeath(playerId) {
  const entry = hitRegistry.get(playerId);
  if (!entry) return "the environment";
  switch (entry.cause) {
    case "fall":
      return "fall damage";
    case "lava":
      return "lava";
    case "fire":
    case "fire_tick":
      return "fire";
    case "drowning":
      return "drowning";
    case "void":
      return "the void";
    case "explosion":
      return "explosion";
    case "projectile":
      return "shot";
    default:
      return "the environment";
  }
}

// ======================================================
// showDeathUI (แสดง title + sound ตอนผู้เล่นตาย)
// ======================================================
function showDeathUI(player, killerDisplay) {
  player.onScreenDisplay.setTitle("§cYOU DIED", {
    fadeInDuration: 10,
    stayDuration: 80,
    fadeOutDuration: 100,
    subtitle: `§7Killed by ${killerDisplay}`,
  });
  player.playSound("random.orb", {
    volume: 1,
    pitch: 0.6,
  });
}

// ======================================================
// Send Death Message (ส่งข้อความ death + stats ให้ผู้เล่น)
// ======================================================
function sendDeathMessage(player, killerDisplay) {
  const stats = playerStats.get(player.id) ?? { kills: 0, deaths: 0 };
  player.sendMessage(
    `\n` +
      `§7==========================\n` +
      `§c            YOU DIED\n` +
      `§7==========================\n\n` +
      `§eKilled by §r${killerDisplay}\n\n` +
      `§eSTATS\n` +
      `§7 » Kills: §c${stats.kills}\n` +
      `§7 » Deaths: §c${stats.deaths}\n\n` +
      `§9 » Sleeplite SMP\n\n` +
      `§7==========================\n\n`,
  );
}

// ======================================================
// Process Death Batch (ประมวลผล deathQueue ทีละชุด batch)
// ======================================================
const deathQueue = [];
let deathBatchRunning = false;

function processDeathBatch() {
  let count = 0;
  let dynamicBatch = 5;
  if (deathQueue.length > 20) {
    dynamicBatch = 10;
  }
  while (count < dynamicBatch) {
    const entry = deathQueue.shift();
    if (!entry) break;
    const player = entry.player;
    if (!player?.isValid) continue;
    const killerDisplay = getKillerDisplay(player);
    showDeathUI(player, killerDisplay);
    sendDeathMessage(player, killerDisplay);
    count++;
  }

  if (deathQueue.length === 0) {
    deathBatchRunning = false;
    return;
  }

  system.run(processDeathBatch);
}

// ======================================================
//
// showDeathScreenshot (เพิ่ม player ลง queue และเริ่ม batch หากยังไม่ทำงาน)
//
// ======================================================
function showDeathScreenshot(player) {
  if (!player?.isValid) return;
  deathQueue.push({ player });
  if (deathBatchRunning) return;
  deathBatchRunning = true;
  system.run(processDeathBatch);
}

// ======================================================
// GlobalPlayerCaches / ensureGPC
// เก็บ cache ผู้เล่นกลาง + สร้าง object ถ้ายังไม่มี
// ======================================================
const GlobalPlayerCaches = new Map();

function ensureGPC(id) {
  let cache = GlobalPlayerCaches.get(id);
  if (cache) return cache;

  cache = {};
  GlobalPlayerCaches.set(id, cache);
  return cache;
}

// ======================================================
// createCacheProxy
// สร้าง proxy cache สำหรับ GlobalPlayerCaches (O(1) size)
// ======================================================
function createCacheProxy(key) {
  let size = 0;

  const proxy = {
    get(id) {
      return GlobalPlayerCaches.get(id)?.[key];
    },

    set(id, val) {
      const cache = ensureGPC(id);
      const exists = cache[key] !== undefined;

      cache[key] = val;

      if (!exists) size++;
      return proxy;
    },

    delete(id) {
      const cache = GlobalPlayerCaches.get(id);
      if (!cache || cache[key] === undefined) return false;

      delete cache[key];
      size--;
      return true;
    },

    has(id) {
      return GlobalPlayerCaches.get(id)?.[key] !== undefined;
    },

    *entries() {
      for (const [id, cache] of GlobalPlayerCaches.entries()) {
        if (!cache) continue;

        const value = cache[key];
        if (value === undefined) continue;

        yield [id, value];
      }
    },

    clear() {
      for (const cache of GlobalPlayerCaches.values()) {
        if (cache && cache[key] !== undefined) {
          delete cache[key];
        }
      }
      size = 0;
    },

    get size() {
      return size;
    },
  };

  return proxy;
}

// ======================================================
// Player Cache Proxies + UHC Player Registry
// จัดการ cache ผู้เล่น + UHC state (O(1) size)
// ======================================================

const uhcPlayerIds = {
  _size: 0,

  has(id) {
    return GlobalPlayerCaches.get(id)?.isUhc === true;
  },

  add(id) {
    const cache = ensureGPC(id);
    if (cache.isUhc === true) return this;

    cache.isUhc = true;
    this._size++;
    return this;
  },

  delete(id) {
    const cache = GlobalPlayerCaches.get(id);
    if (!cache || cache.isUhc !== true) return false;

    delete cache.isUhc;
    this._size--;
    return true;
  },

  clear() {
    for (const c of GlobalPlayerCaches.values()) {
      if (c.isUhc === true) {
        delete c.isUhc;
      }
    }
    this._size = 0;
  },

  get size() {
    return this._size;
  },
};

for (let i = 0; i < teamsLen; i++) {
  const teamId = TEAMS[i].id;
  teamStats.set(teamId, { kills: 0, deaths: 0 });
}

const isUHC = (e) => e && uhcPlayerIds.has(e.id);

// ======================================================
// safeParseDynamicMap
// แปลง dynamic property (string) → object แบบปลอดภัย
// ======================================================
function safeParseDynamicMap(rawValue, label) {
  if (typeof rawValue !== "string" || rawValue.length === 0) {
    return null;
  }

  try {
    const parsed = JSON.parse(rawValue);

    if (!parsed || typeof parsed !== "object") {
      console.warn(`[UHC] Ignored invalid ${label} dynamic property payload.`);
      return null;
    }

    if (Array.isArray(parsed)) {
      console.warn(`[UHC] Ignored array ${label} dynamic property payload.`);
      return null;
    }

    return parsed;
  } catch (error) {
    console.warn(`[UHC] Failed to parse ${label} dynamic property: ` + error);
    return null;
  }
}

// ======================================================
// clearTeamRuntimeState - เคลียร์ team runtime state (count/index) และ sync UI
// ======================================================
function clearTeamRuntimeState() {
  const teamsLen = TEAMS.length;
  for (let i = 0; i < teamsLen; i++) {
    const teamId = TEAMS[i].id;
    teamCounts.set(teamId, 0);
    teamPlayerIndex.set(teamId, new Set());
    updateSidebar(teamId);
  }
}

// ======================================================
// rebuildTeamRuntimeState - rebuild team cache/count/index จาก player DP
// ======================================================
export function rebuildTeamRuntimeState(players) {
  playerTeamCache.clear();
  clearTeamRuntimeState();

  const pLen = players.length;

  for (let i = 0; i < pLen; i++) {
    const p = players[i];
    if (!p) continue;
    if (!p.isValid) continue;

    const teamId = p.getDynamicProperty(CONFIG.key);
    if (typeof teamId !== "string") continue;
    if (!TEAM_LOOKUP.has(teamId)) continue;

    playerTeamCache.set(p.id, teamId);

    if (isGameRunning && !p?.hasTag("uhc")) continue;

    let count = teamCounts.get(teamId);
    if (!Number.isFinite(count)) {
      count = 0;
    }

    count = count + 1;
    teamCounts.set(teamId, count);

    const set = teamPlayerIndex.get(teamId);
    if (set) {
      set.add(p.id);
    }
  }
}

// ======================================================
// removePlayerFromRuntimeState - ลบผู้เล่นออกจาก team/runtime + cleanup data
// ======================================================
function removePlayerFromRuntimeState(id, teamId, fullCleanup) {
  if (teamId === undefined) {
    teamId = playerTeamCache.get(id);
  }
  if (fullCleanup === undefined) {
    fullCleanup = false;
  }
  if (teamId && TEAM_LOOKUP.has(teamId)) {
    const set = teamPlayerIndex.get(teamId);
    if (set) {
      set.delete(id);
    }
    let count = teamCounts.get(teamId);
    if (!Number.isFinite(count)) {
      count = 0;
    }
    count = count - 1;
    if (count < 0) {
      count = 0;
    }
    teamCounts.set(teamId, count);
    updateSidebar(teamId);
  }
  playerTeamCache.delete(id);
  if (!fullCleanup) return;
  playerCache.delete(id);
  hitRegistry.delete(id);
  deathLocation.delete(id);
  multiKill.delete(id);
  killStreak.delete(id);
  uhcPlayerIds.delete(id);
}

// ======================================================
// initScoreboard - สร้าง/โหลด objective scoreboard ที่ใช้ในระบบ
// ======================================================
let kdHistoryObj = null;
let teamKillObj = null;
system.run(() => {
  const sb = world.scoreboard;
  if (!sb) return;
  let obj = sb.getObjective(KD.SCORE_HISTORY_OBJECTIVE);
  if (!obj) {
    obj = sb.addObjective(KD.SCORE_HISTORY_OBJECTIVE, "KD History");
  }
  kdHistoryObj = obj;
  let teamObj = sb.getObjective("uhc_teamkills");
  if (!teamObj) {
    teamObj = sb.addObjective("uhc_teamkills", "Team Kills");
  }
  teamKillObj = teamObj;
});

// ======================================================
// initStats - โหลด stats จาก DynamicProperty เข้า Map
// ======================================================
system.run(() => {
  // TEAM
  const dTeam = world.getDynamicProperty("uhc_teamStats");
  const parsedTeamStats = safeParseDynamicMap(dTeam, "uhc_teamStats");

  if (parsedTeamStats) {
    const entries = Object.entries(parsedTeamStats);
    const len = entries.length;

    for (let i = 0; i < len; i++) {
      const [k, v] = entries[i];
      if (!v) continue;
      if (!teamStats.has(k)) continue;

      const killsRaw = Number(v.kills);
      let kills = 0;
      if (Number.isFinite(killsRaw)) {
        kills = killsRaw;
      }

      const deathsRaw = Number(v.deaths);
      let deaths = 0;
      if (Number.isFinite(deathsRaw)) {
        deaths = deathsRaw;
      }

      teamStats.set(k, { kills, deaths });
    }
  }

  // PLAYER
  const dPlayer = world.getDynamicProperty("uhc_playerStats");
  const parsedPlayerStats = safeParseDynamicMap(dPlayer, "uhc_playerStats");

  if (parsedPlayerStats) {
    const entries = Object.entries(parsedPlayerStats);
    const len = entries.length;

    for (let i = 0; i < len; i++) {
      const [k, v] = entries[i];
      if (!v) continue;
      if (typeof k !== "string" || k.length === 0) continue;

      const killsRaw = Number(v.kills);
      let kills = 0;
      if (Number.isFinite(killsRaw)) {
        kills = killsRaw;
      }

      const deathsRaw = Number(v.deaths);
      let deaths = 0;
      if (Number.isFinite(deathsRaw)) {
        deaths = deathsRaw;
      }

      let name = undefined;
      if (typeof v.name === "string") {
        name = v.name;
      }

      let teamId = undefined;
      if (typeof v.teamId === "string") {
        teamId = v.teamId;
      }

      playerStats.set(k, { kills, deaths, name, teamId });
    }
  }
});

// ======================================================
//
//  Schedule Save Stats
//
// ======================================================
let statsDirty = false;
let statsSaveTask = null;

function scheduleSaveStats() {
  statsDirty = true;
  if (statsSaveTask !== null) return;
  statsSaveTask = system.runTimeout(runSaveStats, 60);
}

// ======================================================
//  Run Save
// ======================================================
function runSaveStats() {
  statsSaveTask = null;
  if (!statsDirty) return;
  statsDirty = false;
  saveTeamStats();
  system.runTimeout(savePlayerStats, 2);
}

// ======================================================
//  Save Team Stats
// ======================================================
function saveTeamStats() {
  try {
    const data = Object.fromEntries(teamStats);
    const json = JSON.stringify(data);
    world.setDynamicProperty("uhc_teamStats", json);
  } catch (e) {
    console.warn("[UHC] saveStats teamStats failed:", e);
  }
}

// ======================================================
//  Save Player Stats
// ======================================================
function savePlayerStats() {
  try {
    const data = Object.fromEntries(playerStats);
    const json = JSON.stringify(data);
    world.setDynamicProperty("uhc_playerStats", json);
  } catch (e) {
    console.warn("[UHC] saveStats playerStats failed:", e);
  }
}

// ======================================================
//  Score Helper (บันทึกประวัติ Killer vs Victim)
// ======================================================
function incrementPairHistory(killer, victim) {
  if (!kdHistoryObj) return;
  if (!killer) return;
  if (!victim) return;
  if (!killer.isValid) return;
  if (!victim.isValid) return;

  const killerName = killer.name;
  const victimName = victim.name;
  const historyKey = "Kill: " + killerName + " | Victim : " + victimName;

  kdHistoryObj.addScore(historyKey, 1);
}

// ======================================================
//  Hit Tracking (บันทึก attacker ล่าสุดของ victim)
// ======================================================
function trackHit(attacker, victim, cause) {
  if (!victim) return;
  const victimId = victim.id;
  if (!victimId) return;
  if (attacker === victim) return;

  const attackerId = attacker?.id;

  let finalCause = cause;
  if (!finalCause) {
    finalCause = "unknown";
  }

  const currentTick = system.currentTick;
  const existing = hitRegistry.get(victimId);

  if (!existing) {
    hitRegistry.set(victimId, {
      attackerId: attackerId,
      cause: finalCause,
      tick: currentTick,
    });
    return;
  }

  existing.attackerId = attackerId;
  existing.cause = finalCause;
  existing.tick = currentTick;
}

// ======================================================
//  Memory Cleanup (ล้าง hitRegistry ตามเวลา)
// ======================================================
system.runInterval(() => {
  const currentTick = system.currentTick;
  for (const [victimId, entry] of hitRegistry.entries()) {
    if (!entry) continue;
    if (currentTick - entry.tick > HIT_TIMEOUT_TICKS) {
      hitRegistry.delete(victimId);
    }
  }
}, 200);

// ======================================================
//  Resolve Killer (หา attacker ล่าสุดของ victim)
// ======================================================
function resolveKiller(victimId) {
  if (!victimId) return null;
  const entry = hitRegistry.get(victimId);
  if (!entry) return null;
  const currentTick = system.currentTick;
  if (currentTick - entry.tick > HIT_TIMEOUT_TICKS) {
    hitRegistry.delete(victimId);
    return null;
  }
  const killer = playerCache.get(entry.attackerId);
  if (!killer) return null;
  if (!killer.isValid) return null;
  return killer;
}

// ======================================================
//  Multi Kill Config (กำหนดข้อความ + เสียงตามจำนวน kill)
// ======================================================
const MULTI_KILL_DATA = [
  null,
  { text: "§eKILL", sound: "kill1" },
  { text: "§6DOUBLE KILL", sound: "kill2" },
  { text: "§cTRIPLE KILL", sound: "kill3" },
  { text: "§5QUADRA KILL", sound: "kill4" },
  { text: "§4ACE", sound: "kill5" },
];

// ======================================================
//  Multi Kill Handler (จัดการ kill ต่อเนื่องตามเวลา)
// ======================================================
function handleMultiKill(killer) {
  if (!killer) return;
  if (!killer.isValid) return;

  const id = killer.id;
  const now = system.currentTick;
  let data = multiKill.get(id);
  if (!data) {
    data = { count: 1, tick: now };
    multiKill.set(id, data);
  } else {
    if (now - data.tick > MULTI_TIMEOUT_TICKS) {
      data.count = 1;
      data.tick = now;
    } else {
      data.count = data.count + 1;
      data.tick = now;
    }
  }

  let count = data.count;
  if (count > 5) {
    count = 5;
  }

  const info = MULTI_KILL_DATA[count];
  if (!info) return;
  const message = info.text + " §7| §f" + killer.name;
  world.sendMessage(dynamicToast(message, "textures/ui/icons/icon_multiplayer"));
  killer.playSound(info.sound);
}

// ======================================================
//  Kill Streak Handler (นับ kill ต่อเนื่อง)
// ======================================================
function handleKillStreak(killer) {
  if (!killer) return;
  if (!killer.isValid) return;
  let current = killStreak.get(killer.id);
  if (current === undefined) {
    current = 0;
  }
  current = current + 1;
  killStreak.set(killer.id, current);
}

// ======================================================
//  First Blood Handler (kill แรกของเกม)
// ======================================================
let firstBloodDone = false;
function handleFirstBlood(killer, victim) {
  if (!killer) return;
  if (!victim) return;
  if (!killer.isValid) return;
  if (!victim.isValid) return;
  if (firstBloodDone) return;
  firstBloodDone = true;
  const message = "§cFIRST BLOOD §7| " + killer.name + " > §f" + victim.name;
  world.sendMessage(dynamicToast(message, "textures/ui/friend_glyph_desaturated"));
  killer.playSound("mob.wither.death");
}

// ======================================================
//  Shared Location Pools (ลดการสร้าง object ซ้ำ)
// ======================================================
const particleLocPool = { x: 0, y: 0, z: 0 };
const teleportLocPool = { x: 0, y: 0, z: 0 };
const spawnEntityLocPool = { x: 0, y: 0, z: 0 };

// ======================================================
//  Entity Query Config (ใช้ร่วมสำหรับหา item)
// ======================================================
const entityQueryOptions = {
  type: "minecraft:item",
  location: { x: 0, y: 0, z: 0 },
  maxDistance: 16,
};

// ======================================================
//  Item Vacuum Queue (จัดคิวดูดไอเทม)
// ======================================================
const itemVacuumQueue = [];
let itemVacuumRunning = false;
function drainItemVacuumQueue() {
  if (itemVacuumQueue.length === 0) {
    itemVacuumRunning = false;
    return;
  }
  itemVacuumRunning = true;
  const job = itemVacuumQueue.shift();
  if (!job) {
    drainItemVacuumQueue();
    return;
  }
  system.runTimeout(() => {
    try {
      job();
    } catch (error) {
      console.warn("[VacuumQueue] job error:", error);
    }
    drainItemVacuumQueue();
  }, 3);
}

function enqueueItemVacuum(job) {
  if (!job) return;
  itemVacuumQueue.push(job);
  if (itemVacuumRunning) return;
  drainItemVacuumQueue();
}

// ======================================================
//  processVictimDeath (จัดการเมื่อผู้เล่นตาย)
// ======================================================
function processVictimDeath(player, victimTeamId, loc) {
  const id = player.id;
  removePlayerFromAliveRuntimeState(id, victimTeamId);
  if (!loc) return;
  const dim = player.dimension;
  if (!dim) return;

  // save death location
  deathLocation.set(id, { x: loc.x, y: loc.y, z: loc.z });

  // particle
  particleLocPool.x = loc.x;
  particleLocPool.y = loc.y + 4.5;
  particleLocPool.z = loc.z;
  dim.spawnParticle("so:light2", particleLocPool);

  particleLocPool.y = loc.y + 6.5;
  dim.spawnParticle("so:light5", particleLocPool);

  const snapX = loc.x;
  const snapY = loc.y;
  const snapZ = loc.z;

  // spectator + item vacuum
  system.runTimeout(() => {
    if (!player || !player.isValid) return;

    player.removeTag("uhc");
    player.setGameMode(GameMode.Spectator);

    enqueueItemVacuum(() => {
      spawnEntityLocPool.x = snapX;
      spawnEntityLocPool.y = snapY + 0.2;
      spawnEntityLocPool.z = snapZ;

      const cart = dim.spawnEntity("minecraft:hopper_minecart", spawnEntityLocPool);
      if (!cart) return;

      const cartLoc = cart.location;

      entityQueryOptions.location.x = snapX;
      entityQueryOptions.location.y = snapY;
      entityQueryOptions.location.z = snapZ;

      const items = dim.getEntities(entityQueryOptions);
      const itemLen = items.length;

      for (let i = 0; i < itemLen; i++) {
        const item = items[i];
        if (!item || !item.isValid) continue;

        item.teleport(cartLoc, { dimension: dim });
      }
    });
  }, 5);

  // player stats
  const victimPs = playerStats.get(id) ?? { kills: 0, deaths: 0 };
  victimPs.deaths++;
  victimPs.name = player.name;
  if (victimTeamId) {
    victimPs.teamId = victimTeamId;
  }
  playerStats.set(id, victimPs);

  // team stats
  const teamEntry = teamStats.get(victimTeamId);
  if (teamEntry) {
    teamEntry.deaths++;
  }

  // save
  scheduleSaveStats();
}

// ======================================================
//  processKillerRewards (จัดการ reward เมื่อฆ่า)
// ======================================================
function processKillerRewards(killer, victimPlayer, victimTeamId) {
  const killerId = killer.id;
  const killerTeamId = playerTeamCache.get(killerId);

  // กัน team kill
  if (killerTeamId && killerTeamId === victimTeamId) {
    hitRegistry.delete(victimPlayer.id);
    return;
  }

  // history
  incrementPairHistory(killer, victimPlayer);

  // player stats
  const killerPs = playerStats.get(killerId) ?? { kills: 0, deaths: 0 };
  killerPs.kills++;
  killerPs.name = killer.name;
  if (killerTeamId) {
    killerPs.teamId = killerTeamId;
  }
  playerStats.set(killerId, killerPs);

  // team stats=
  const teamEntry = teamStats.get(killerTeamId);
  if (teamEntry) {
    teamEntry.kills++;
  }

  // scoreboard
  if (teamKillObj && killerTeamId) {
    const teamInfo = TEAM_LOOKUP.get(killerTeamId);
    if (teamInfo) {
      const label = `${teamInfo.color}${teamInfo.name}`;
      teamKillObj.addScore(label, 1);
    }
  }

  // save
  scheduleSaveStats();

  // announcer
  handleFirstBlood(killer, victimPlayer);
  handleMultiKill(killer);
  handleKillStreak(killer);
}

// ======================================================
//  onEntityHurt (จัดการเมื่อ entity ได้รับ damage)
// ======================================================
function onHurt(ev) {
  const hurt = ev.hurtEntity;
  if (!hurt) return;
  if (hurt.typeId !== "minecraft:player") return;

  const source = ev.damageSource;
  const attacker = source?.damagingEntity;
  const cause = source?.cause;

  // ไม่ใช่ player attacker
  if (!attacker || attacker.typeId !== "minecraft:player") {
    trackHit(null, hurt, cause);
    return;
  }

  // ไม่ใช่ UHC player
  if (!isUHC(attacker) || !isUHC(hurt)) {
    trackHit(null, hurt, cause);
    return;
  }

  // valid PvP
  trackHit(attacker, hurt, cause);
}

// ======================================================
//  onEntityDeath (จัดการเมื่อ entity ตาย)
// ======================================================
function onDeath(ev) {
  const dead = ev.deadEntity;
  if (!dead) return;
  if (dead.typeId !== "minecraft:player") return;
  if (!dead.isValid) return;
  handleDeath(dead);
}

// ======================================================
//  handlePlayerDeath (จัดการเมื่อผู้เล่นตาย)
// ======================================================
function handleDeath(player) {
  if (!player || !player.isValid) return;
  const id = player.id;
  const victimTeamId = playerTeamCache.get(id);
  const killer = resolveKiller(id);

  // Victim
  if (isUHC(player)) {
    processVictimDeath(player, victimTeamId, player.location);
    killStreak.set(id, 0);
    multiKill.delete(id);
    showDeathScreenshot(player);
  }

  // Killer
  if (!killer) {
    hitRegistry.delete(id);
    return;
  }

  if (!isUHC(killer)) {
    hitRegistry.delete(id);
    return;
  }

  if (killer === player) {
    hitRegistry.delete(id);
    return;
  }

  processKillerRewards(killer, player, victimTeamId);

  hitRegistry.delete(id);
}

// ======================================================
//  On Player Spawn (จัดการเมื่อผู้เล่นเกิด/รีสปอน)
// ======================================================

function onSpawn(ev) {
  const player = ev.player;
  if (!player) return;
  const id = player.id;
  playerCache.set(id, player);

  // stats
  const spawnPs = playerStats.get(id) ?? { kills: 0, deaths: 0 };
  spawnPs.name = player.name;
  const cachedTeamId = playerTeamCache.get(id);
  const dynamicProp = player.getDynamicProperty(CONFIG.key);
  const propTeamId = typeof dynamicProp === "string" ? dynamicProp : null;
  const spawnTeamId = cachedTeamId ?? propTeamId;
  if (spawnTeamId) spawnPs.teamId = spawnTeamId;
  playerStats.set(id, spawnPs);
  scheduleSaveStats();

  // cache players
  if (!allPlayersCacheIds.has(id)) {
    allPlayersCache.push(player);
    allPlayersCacheIds.add(id);
  }

  if (player.hasTag("uhc") && !uhcPlayerIds.has(id)) {
    uhcPlayersCache.push(player);
    uhcPlayerIds.add(id);
  }

  // respawn teleport
  if (!ev.initialSpawn) {
    const loc = deathLocation.get(id);
    if (loc) {
      const dimension = player.dimension ?? world.getDimension("overworld");

      teleportLocPool.x = loc.x + 0.5;
      teleportLocPool.y = loc.y;
      teleportLocPool.z = loc.z + 0.5;

      player.teleport(teleportLocPool, { dimension });
      deathLocation.delete(id);
    }
  }

  // resolve team
  const dynamicTeam = propTeamId ?? cachedTeamId;

  // spectator
  if (isGameRunning && !player.hasTag("uhc")) {
    player.setGameMode(GameMode.Spectator);
    player.addEffect("conduit_power", 1, { amplifier: 255, showParticles: false });
    return;
  }

  if (!dynamicTeam) return;

  //team runtime sync
  const inCache = playerTeamCache.has(id);

  if ((!inCache && !isGameRunning) || player?.hasTag("uhc")) {
    const before = teamCounts.get(dynamicTeam) ?? 0;
    teamCounts.set(dynamicTeam, before + 1);
    teamPlayerIndex.get(dynamicTeam)?.add(id);
    updateSidebar(dynamicTeam);
  }

  setTeam(player, dynamicTeam);
}

// ======================================================
//  On Player Leave (จัดการเมื่อผู้เล่นออกจากเกม)
// ======================================================
function onLeave(ev) {
  const id = ev.playerId;
  if (!id) return;
  const teamId = playerTeamCache.get(id);
  const isCounted = !isGameRunning || uhcPlayerIds.has(id);
  const countedTeamId = isCounted ? teamId : null;
  removePlayerFromRuntimeState(id, countedTeamId, true);

  // allPlayersCache
  const idx1 = allPlayersCache.findIndex((p) => p.id === id);
  if (idx1 !== -1) {
    allPlayersCache[idx1] = allPlayersCache[allPlayersCache.length - 1];
    allPlayersCache.pop();
  }

  allPlayersCacheIds.delete(id);

  // uhcPlayersCache
  const idx2 = uhcPlayersCache.findIndex((p) => p.id === id);
  if (idx2 !== -1) {
    uhcPlayersCache[idx2] = uhcPlayersCache[uhcPlayersCache.length - 1];
    uhcPlayersCache.pop();
  }

  // cleanup
  if (itemVacuumQueue.length > 0) {
    deathLocation.delete(id);
  }

  aliveTeamDirtyHandler();
  GlobalPlayerCaches.delete(id);
}

// ======================================================
//  onChatFormat (จัดรูปแบบแชททีม)
// ======================================================
function onChat(ev) {
  const player = ev.sender;
  if (!player || !player.isValid) return;
  const message = ev.message;
  if (!message) return;
  const trimmed = message.trim();
  if (trimmed.length === 0) return;
  if (trimmed[0] === "!") return;
  const teamId = playerTeamCache.get(player.id);
  if (!teamId) return;
  const teamInfo = TEAM_LOOKUP.get(teamId);
  if (!teamInfo) return;
  const teamIndexRaw = TEAM_INDEX_MAP.get(teamId);
  const teamIndex = (teamIndexRaw ?? -1) + 1;
  ev.cancel = true;
  const formattedMessage = `[${teamIndex}] ${teamInfo.color}${player.name}§r: ${trimmed}`;
  world.sendMessage(formattedMessage);
}

// ======================================================
//  openTeamMenu (เปิดเมนูเลือก/ออก/รีเฟรชทีม)
// ======================================================
function openTeamMenu(player) {
  if (isGameRunning && player.hasTag("uhc") && !player.hasTag(CONFIG.adminTag)) {
    player.sendMessage(dynamicToast("§cไม่สามารถเปลี่ยนทีมระหว่างเกมได้", "textures/ui/cancel"));
    player.playSound("note.bassattack");
    return;
  }
  const form = new ActionFormData();
  form.title(CONFIG.title + "Team Manager");
  const currentTeamId = getPlayerTeam(player);
  const currentTeam = currentTeamId ? TEAM_LOOKUP.get(currentTeamId) : null;
  let teamDisplay = "Team?";
  if (currentTeam) {
    teamDisplay = `${currentTeam.color}${currentTeam.name}`;
  }
  form.body(`§f${player.name}: ${teamDisplay}`);
  const teamsLen = TEAMS.length;
  for (let i = 0; i < teamsLen; i++) {
    const team = TEAMS[i];
    form.button(`${team.color}${team.name}`, team.icon);
  }
  form.button("§cLeave", "textures/ui/permissions_visitor_hand");
  form.button("§6Refresh", "textures/ui/refresh_light");
  form.button("§7Close", "textures/ui/cancel");
  form.show(player).then((res) => {
    if (!res || res.canceled) return;
    const selection = res.selection;
    // =========================
    // เลือกทีม
    // =========================
    if (selection < teamsLen) {
      const selectedTeam = TEAMS[selection];
      if (currentTeamId === selectedTeam.id) {
        player.playSound("note.bassattack");
        player.sendMessage(dynamicToast("§oAlready", selectedTeam.icon));
        system.run(() => openTeamMenu(player));
        return;
      }
      joinTeam(player, selectedTeam.id);
      try {
        particleLocPool.x = player.location.x;
        particleLocPool.y = player.location.y + 1;
        particleLocPool.z = player.location.z;
        player.dimension.spawnParticle(selectedTeam.id, particleLocPool);
      } catch (e) {
        console.info("[spawnParticle] Ignore Error ");
      }
      player.playSound("random.orb", { pitch: 0.6, volume: 0.4 });
      player.sendMessage(dynamicToast(`Joined ${selectedTeam.color}${selectedTeam.name}`, selectedTeam.icon));
      system.run(() => openTeamMenu(player));
      return;
    }

    // =========================
    // action
    // =========================
    const actionIndex = selection - teamsLen;
    switch (actionIndex) {
      case 0: {
        if (!currentTeamId || !currentTeam) {
          player.playSound("note.bassattack");
          player.sendMessage(dynamicToast("§cYou have no team", "textures/ui/cancel"));
          system.run(() => openTeamMenu(player));
          return;
        }
        leaveTeam(player);
        player.playSound("random.break");
        player.sendMessage(dynamicToast(`§c§oLeft from ${currentTeam.color}${currentTeam.name}`, "textures/ui/permissions_visitor_hand"));
        system.run(() => openTeamMenu(player));
        return;
      }
      case 1:
        system.run(() => openTeamMenu(player));
        return;
      case 2:
        return;
    }
  });
}

// ======================================================
// Player List Menu (เมนูรายชื่อผู้เล่น)
// ======================================================
function playerLists(player) {
  if (!player) return;
  if (!player.isValid) return;
  refreshPlayerCaches();
  const form = new ActionFormData();
  form.title("Player List");
  const players = getCachedPlayers();
  const pLen = players.length;
  let count = 0;
  for (let i = 0; i < pLen; i++) {
    const p = players[i];
    if (!p) continue;
    if (!p.isValid) continue;
    const teamId = playerTeamCache.get(p.id);
    let label = p.name + " | No Team";
    let icon = "textures/ui/world_glyph_desaturated";
    if (teamId) {
      const team = TEAM_LOOKUP.get(teamId);
      if (team) {
        label = p.name + " §8| " + team.color + team.name + "§r";
        icon = team.icon;
      }
    }
    form.button(label, icon);
    count++;
  }

  if (count === 0) {
    form.body("No players online.");
  }
  const backIndex = count;
  form.button("Back");
  form.show(player).then((res) => {
    if (!res) return;
    if (res.canceled) return;
    if (res.selection === backIndex) {
      AdminMenu(player);
      return;
    }
  });
}

// ======================================================
// Kill Death History Menu (เมนูประวัติการฆ่าและการตาย)
// ======================================================
function killList(player) {
  if (!player) return;
  if (!player.isValid) return;
  if (!kdHistoryObj) return;

  const participants = kdHistoryObj.getParticipants();
  const totals = new Map();
  let history = "";

  if (!participants) return;
  const pLen = participants.length;

  for (let i = 0; i < pLen; i++) {
    const p = participants[i];
    if (!p) continue;
    const score = kdHistoryObj.getScore(p);
    if (!score) continue;
    const key = p.displayName;
    if (!key) continue;
    const parts = key.split(" | Victim : ");
    if (parts.length !== 2) continue;
    const killer = parts[0].replace("Kill: ", "");
    if (!killer) continue;
    history += "§7" + key + " §8= §c" + score + "\n";
    const current = totals.get(killer);
    if (current) {
      totals.set(killer, current + score);
    } else {
      totals.set(killer, score);
    }
  }

  const form = new ActionFormData();
  form.title("Kill Death History");

  // =========================
  // ไม่มีข้อมูล
  // =========================
  if (history === "") {
    form.body("History is empty.");
    form.button("Console");
    form.button("Back", "textures/ui/arrow_left_white");
    form.show(player).then((res) => {
      if (!res) return;
      if (res.canceled) return;
      if (res.selection === 0) {
        console.warn("[KD] History is empty.");
      }
      AdminMenu(player);
    });

    return;
  }

  // =========================
  // รวม Kill
  // =========================
  let body = "§f=== TOTAL KILLS ===\n";
  const sortedTotals = Array.from(totals.entries()).sort(function (a, b) {
    return b[1] - a[1];
  });
  const sLen = sortedTotals.length;
  for (let i = 0; i < sLen; i++) {
    const entry = sortedTotals[i];
    const killer = entry[0];
    const total = entry[1];
    body += "§7" + killer + " §8= §c" + total + "\n";
  }
  body += "\n§f=== HISTORY ===\n";
  body += history.trimEnd();
  const plain = body.replace(/§./g, "");
  form.body(body);
  form.button("Console", "textures/ui/icons/icon_fall");
  form.button("Back");
  form.show(player).then((res) => {
    if (!res) return;
    if (res.canceled) return;
    if (res.selection === 0) {
      console.warn("[KD] Dump:\n" + plain);
    }
    AdminMenu(player);
  });
}

// ======================================================
// Clear Teams (ลบข้อมูลทีม)
// ======================================================
function clearTeams(player) {
  if (!player?.isValid) return;
  const form = new ActionFormData()
    .title("Confirm §4Clear All Teams")
    .body("จะลบผู้เล่นทุกคนออกจากทุกทีม 'คุณแน่ใจหรือไม่?'")
    .button("§cYes", "textures/ui/container_weight_bar_full")
    .button("§9No", "textures/ui/container_weight_bar_fill");
  form.show(player).then((res) => {
    if (!res || res.canceled) return;
    if (res.selection !== 0) return;
    clearAllTeams(player);
    const teamsLen = TEAMS.length;
    for (let i = 0; i < teamsLen; i++) {
      updateSidebar(TEAMS[i].id);
    }
  });
}

// ======================================================
//
//           Teleport System (ระบบเทเลพอร์ต)
//
// ======================================================
function AdminTeleport(source, target) {
  if (!source) return;
  if (!source.isValid) return;
  if (!target) return;
  if (!target.isValid) return;
  const loc = target.location;
  if (!loc) return;
  teleportLocPool.x = loc.x;
  teleportLocPool.y = loc.y;
  teleportLocPool.z = loc.z;
  let dim = target.dimension;
  if (!dim) {
    dim = world.getDimension("overworld");
  }
  source.teleport(teleportLocPool, { dimension: dim });
}

function playerTeleport(source, target) {
  if (!source) return;
  if (!source.isValid) return;
  if (!target) return;
  if (!target.isValid) {
    source.sendMessage("§cผู้เล่นเป้าหมายไม่ได้ออนไลน์หรือไม่ได้อยุ่ในเซิฟปแล้ว");
    return;
  }
  source.teleport(target.location, { dimension: target.dimension });
  source.playSound("teleport.ender_pearl");
}

function teleportGetAllPlayers(player) {
  const players = world.getPlayers();
  const result = [];
  for (let i = 0; i < players.length; i++) {
    const p = players[i];
    if (!p) continue;
    if (!p.isValid) continue;
    if (player) {
      if (p.id === player.id) continue;
    }
    result.push(p);
  }
  return result;
}

// ======================================================
// Show Teleport Form (แสดงแบบฟอร์มเทเลพอร์ต)
// ======================================================
function showTeleportForm(player, isAdmin) {
  if (!player) return;
  if (!player.isValid) return;

  refreshPlayerCaches();

  const others = getOtherUhcPlayers(player.id);
  const form = new ActionFormData();
  form.title("Teleport Menu");

  const buttonMap = [];

  form.button("Random Teleport", "textures/ui/icon_random");
  buttonMap.push({ type: "random" });

  form.button("All Players", "textures/ui/multiplayer_glyph_color");
  buttonMap.push({ type: "all" });

  const teamCountLocal = new Map();

  for (let i = 0; i < others.length; i++) {
    const tid = playerTeamCache.get(others[i].id);
    if (tid) {
      teamCountLocal.set(tid, (teamCountLocal.get(tid) ?? 0) + 1);
    }
  }

  for (let i = 0; i < TEAMS.length; i++) {
    const team = TEAMS[i];
    const count = teamCountLocal.get(team.id) ?? 0;
    if (count > 0) {
      form.button(team.color + team.name + " §8(" + count + ")", team.icon);
      buttonMap.push({ type: "team", teamId: team.id });
    }
  }

  if (isAdmin) {
    form.button("Back");
    buttonMap.push({ type: "back" });
  }

  form.show(player).then((res) => {
    if (!res) return;
    if (res.canceled) return;
    const action = buttonMap[res.selection];
    if (!action) return;
    switch (action.type) {
      case "random":
        teleportRandom(player, isAdmin);
        break;
      case "all":
        teleportShowAllPlayers(player, isAdmin);
        break;
      case "team":
        teleportShowTeamPlayers(player, action.teamId, isAdmin);
        break;
      case "back":
        AdminMenu(player);
        break;
    }
  });
}

// ======================================================
// Teleport Random (เทเลพอร์ตสุ่มไปหาผู้เล่น)
// ======================================================
function teleportRandom(player, isAdmin) {
  const candidates = getOtherUhcPlayers(player.id);

  if (candidates.length === 0) {
    player.sendMessage("§c[x] No valid UHC players.");
    return;
  }

  const target = candidates[(Math.random() * candidates.length) | 0];

  if (isAdmin) {
    AdminTeleport(player, target);
  } else {
    playerTeleport(player, target);
  }
}

// ======================================================
// Teleport Show All Players (เทเลพอร์ตแสดงผู้เล่นทั้งหมด)
// ======================================================
function teleportShowAllPlayers(player, mode) {
  refreshPlayerCaches();

  const others = teleportGetAllPlayers(player);
  const form = new ActionFormData();
  form.title("All Players");

  if (others.length === 0) {
    form.body("No available players.");
    form.button("Back");
    form.show(player).then(() => {
      showTeleportForm(player, mode);
    });
    return;
  }

  for (let i = 0; i < others.length; i++) {
    const p = others[i];
    let label = p.name + " §8| No Team";
    const teamId = playerTeamCache.get(p.id);
    if (teamId) {
      const team = TEAM_LOOKUP.get(teamId);
      if (team) {
        label = team.color + p.name + " §8| " + team.name;
      }
    }
    form.button(label, "textures/ui/multiplayer_glyph_color");
  }
  form.button("Back");
  form.show(player).then((res) => {
    if (!res) return;
    if (res.canceled) return;
    if (res.selection === others.length) {
      showTeleportForm(player, mode);
      return;
    }
    const target = others[res.selection];
    if (!target) return;
    if (!target.isValid) return;
    mode.doTeleport(player, target);
  });
}

// ======================================================
// Teleport Show Team Players (เทเลพอร์ตแสดงทีมผู้เล่น)
// ======================================================
function teleportShowTeamPlayers(player, teamId, mode) {
  refreshPlayerCaches();
  const team = TEAM_LOOKUP.get(teamId);
  if (!team) return showTeleportForm(player, mode);

  const teamPlayers = getOtherUhcPlayers(player.id).filter((p) => playerTeamCache.get(p.id) === teamId),
    form = new ActionFormData();
  form.title(`${team.color}${team.name} Team`);

  if (teamPlayers.length === 0) {
    form.body("No available players.");
    form.button("Back");
    return form.show(player).then(() => showTeleportForm(player, mode));
  }

  for (let i = 0; i < teamPlayers.length; i++) {
    form.button(`${team.color}${teamPlayers[i].name}`, team.icon);
  }
  form.button("Back");

  form.show(player).then((res) => {
    if (!res || res.canceled) return;
    if (res.selection === teamPlayers.length) return showTeleportForm(player, mode);
    const target = teamPlayers[res.selection];
    if (!target?.isValid) return;
    mode.doTeleport(player, target);
  });
}

// ======================================================
// /tpa Teleport (เทเลพอร์ต)
// ======================================================
export function tpa(player) {
  if (!player) return;
  if (!player.isValid) return;
  if (!isGameRunning) return;
  if (player.hasTag(CONFIG.uhcTag)) {
    player.sendMessage("§cYou cannot use TPA while alive in UHC!");
    return;
  }

  showTeleportForm(player, false);
}

// ======================================================
// Form Managemen Team (ฟอร์มการจัดการทีม)
// ======================================================
function Managements(admin) {
  refreshPlayerCaches();
  const form = new ActionFormData();
  form.title("Team Management");
  const players = getCachedPlayers(),
    pLen = players.length;

  if (pLen === 0) {
    form.body("No players are currently online.");
    form.button("Back");
    return form.show(admin).then(() => AdminMenu(admin));
  }

  for (let i = 0; i < pLen; i++) {
    const p = players[i],
      teamId = playerTeamCache.get(p.id) || p.getDynamicProperty(CONFIG.key),
      team = TEAM_LOOKUP.get(teamId),
      label = team ? `${p.name}\n§8[ ${team.color}${team.name} §8]` : `§f${p.name}\n§8[ §cNo Team §8]`;

    form.button(label, team ? team.icon : "textures/ui/world_glyph_desaturated");
  }

  form.button("Back");

  form.show(admin).then((res) => {
    if (!res || res.canceled) return;
    if (res.selection === players.length) {
      AdminMenu(admin);
      return;
    }

    const target = players[res.selection];
    if (!target?.isValid) return;
    editPlayerMenu(admin, target);
  });
}

// ======================================================
// Edit Player Team (แก้ไขทีมผู้เล่น)
// ======================================================
function editPlayerMenu(admin, target) {
  if (!target?.isValid) return Managements(admin);
  const currentTeamId = playerTeamCache.get(target.id) || target.getDynamicProperty(CONFIG.key),
    form = new ActionFormData();
  form.title(`Manage Team: ${target.name}`);
  const currentTeam = currentTeamId ? TEAM_LOOKUP.get(currentTeamId) : null;
  form.body(`Select a team for ${target.name}.\n§7Current: ${currentTeam ? currentTeam.color + currentTeam.name : "§cUnassigned"}`);
  form.button("Remove from Team", "textures/ui/permissions_visitor_hand");

  const teamsLen = TEAMS.length;
  for (let i = 0; i < teamsLen; i++) {
    const team = TEAMS[i],
      isCurrent = team.id === currentTeamId ? " §a(Selected)" : "";

    form.button(`${team.color}${team.name}${isCurrent}`, team.icon);
  }

  form.button("Back");
  form.show(admin).then((res) => {
    if (!res || res.canceled) return;

    if (res.selection === 0) {
      leaveTeam(target);
      admin.sendMessage(`[System] §f${target.name} §chas been removed from their team.`);
      return Managements(admin);
    }

    if (res.selection <= TEAMS.length) {
      const selectedTeam = TEAMS[res.selection - 1];
      joinTeam(target, selectedTeam.id);
      admin.sendMessage(`[System] §aMoved §f${target.name} §ato ${selectedTeam.color}${selectedTeam.name}§a.`);
      return Managements(admin);
    }

    Managements(admin);
  });
}

// ======================================================
// Show Dump Viewer (ดั้มข้อมูลลงคอนโซล)
// ======================================================
function showDumpViewer(admin, title, body, logTag) {
  const plain = body.replace(/§./g, ""),
    form = new ActionFormData();
  form.title(title);
  form.body(body);
  form.button("Console", "textures/ui/icons/icon_fall");
  form.button("Back");
  form.show(admin).then((res) => {
    if (!res || res.canceled) return;
    if (res.selection === 0) {
      console.warn(`[${logTag}]\n` + plain);
    }
    AdminMenu(admin);
  });
}

const getOtherUhcPlayers = (excludeId) => uhcPlayersCache.filter((p) => p.id !== excludeId);

function getCachedPlayers() {
  return allPlayersCache.length > 0 ? allPlayersCache : world.getPlayers();
}

// ======================================================
//view Dynamic Property
// ======================================================
function viewDynamicProperty(admin) {
  if (!admin?.isValid) return;
  refreshPlayerCaches();
  const players = getCachedPlayers();
  let body = "";
  for (let i = 0; i < players.length; i++) {
    const p = players[i];
    if (!p?.isValid) continue;
    body += `§7${p.name} §8= §c${p.getDynamicProperty(CONFIG.key) ?? "null"}\n`;
  }
  showDumpViewer(admin, "Dynamic Properties", body, "DYNAMIC PROPERTY DUMP");
}

// ======================================================
// View All Maps (ดูข้อมูลของ MAP ทั้วหมด)
// ======================================================
function viewAllMaps(admin) {
  if (!admin?.isValid) return;
  let body = "";

  const dumpMap = (label, map, formatter) => {
    body += `§e[${label}]§r\n`;

    if (!map) {
      body += " §7<null>\n\n";
      return;
    }

    const iterable = typeof map.entries === "function" ? map.entries() : typeof map[Symbol.iterator] === "function" ? map : null;

    if (!iterable) {
      body += " §7<not iterable>\n\n";
      return;
    }

    for (const [k, v] of iterable) {
      try {
        body += formatter(k, v);
      } catch (error) {
        console.warn("View All Maps: " + error);
        body += " §c<format error>\n";
      }
    }

    body += "\n";
  };

  const resolveName = (id) => playerCache.get(id)?.name ?? id;

  dumpMap("teamCounts", teamCounts, (k, v) => ` §7${k} §8: §c${v}\n`);
  dumpMap("playerTeamCache", playerTeamCache, (k, v) => ` §7${resolveName(k)} §8: §c${v}\n`);
  dumpMap("teamStats", teamStats, (k, v) => ` §7${k} §8: §cK:${v.kills} D:${v.deaths}\n`);
  dumpMap("playerStats", playerStats, (k, v) => ` §7${k} §8: §cK:${v.kills} D:${v.deaths}\n`);
  dumpMap("deathLocation", deathLocation, (k, v) => ` §7${resolveName(k)} §8: §c${v.x.toFixed(0)}, ${v.y.toFixed(0)}, ${v.z.toFixed(0)}\n`);
  dumpMap("multiKill", multiKill, (k, v) => ` §7${resolveName(k)} §8: §cCount:${v.count} Tick:${v.tick}\n`);
  dumpMap("killStreak", killStreak, (k, v) => ` §7${resolveName(k)} §8: §cStreak:${v}\n`);
  dumpMap("hitRegistry", hitRegistry, (k, v) => ` §7Victim:${resolveName(k)} §8<- §cAttacker:${resolveName(v.attackerId)} §8(Tick:${v.tick})\n`);

  showDumpViewer(admin, "Map Data Dump", body, "MAP DUMP");
}

// ======================================================
// View Player Status (ดูสถานะผู้เล่น)
// ======================================================
function viewPlayerStatus(admin) {
  if (!admin?.isValid) return;
  refreshPlayerCaches();
  const players = getCachedPlayers();
  let body = "";
  for (let i = 0; i < players.length; i++) {
    const p = players[i];
    if (!p?.isValid) continue;
    let gm = "Unknown";

    if (typeof p.getGameMode === "function") {
      gm = p.getGameMode();
    }

    const health = p.getComponent("minecraft:health") || p.getComponent("health"),
      hp = health && health.currentValue ? health.currentValue.toFixed(1) : "?";
    body += `§e${p.name} §8| GM: §7${gm} §8| HP: §c${hp}\n`;
  }
  showDumpViewer(admin, "Player Status Viewer", body, "PLAYER STATUS DUMP");
}

// ======================================================
// View Uhc Player List (เรียกดูรายชื่อคนที่เล่น UHC)
// ======================================================
function viewUhcPlayerList(admin) {
  if (!admin?.isValid) return;
  refreshPlayerCaches();
  let body = `Total Online UHC Players: §c${uhcPlayersCache.length}\n\n`;
  for (let i = 0; i < uhcPlayersCache.length; i++) {
    const p = uhcPlayersCache[i],
      team = TEAM_LOOKUP.get(playerTeamCache.get(p.id));
    body += team ? `§7${p.name} §8- ${team.color}${team.name}\n` : `§7${p.name} §8- §cNo Team\n`;
  }
  showDumpViewer(admin, "UHC Player List", body, "UHC PLAYER LIST DUMP");
}

// ======================================================
// view Team Stats (ดูสถิติทีม)
// ======================================================
function viewTeamStats(admin) {
  if (!admin?.isValid) return;
  refreshPlayerCaches();
  let body = "";
  for (let i = 0; i < TEAMS.length; i++) {
    const team = TEAMS[i],
      stats = teamStats.get(team.id) ?? { kills: 0, deaths: 0 },
      alive = teamCounts.get(team.id) ?? 0,
      players = getPlayersByTeam(team.id);

    body += `${team.color}${team.name} §8| Alive: §a${alive} §8| Kills: §c${stats.kills} §8| Deaths: §4${stats.deaths}\n`;
    for (let j = 0; j < players.length; j++) {
      body += `${team.color} - ${players[j].name}\n`;
    }
    if (players.length) body += "\n";
  }
  showDumpViewer(admin, "Team Stats", body, "TEAM STATS DUMP");
}

// ======================================================
// View Death Locations (ดูสถานที่เสียชีวิต)
// ======================================================
function viewDeathLocations(admin) {
  if (!admin?.isValid) return;
  let body = "";
  for (const [id, loc] of deathLocation) {
    const name = playerCache.get(id)?.name ?? id;
    body += `§c${name} §8died at §e${loc.x.toFixed(0)}, ${loc.y.toFixed(0)}, ${loc.z.toFixed(0)}\n`;
  }
  if (!deathLocation.size) body += "§7No deaths recorded.";
  showDumpViewer(admin, "Death Locations", body, "DEATH LOCATIONS DUMP");
}

// ======================================================
//
//            AdminMenu (เมนูผู้ดูแลระบบ)
//
// ======================================================
function AdminMenu(player) {
  const form = new ActionFormData();
  form.title("§g§rAdmin");
  form.button("Player", "textures/ui/sidebar_icons/genre");
  form.button("Kill", "textures/ui/sidebar_icons/character_creator");
  form.button("Clear", "textures/ui/icon_trash");
  form.button("Teleport", "textures/ui/sidebar_icons/my_characters");
  form.button("Manager", "textures/ui/icons/icon_blackfriday");
  form.button("Dynamic Props", "textures/ui/icon_recipe_item");
  form.button("View Maps", "textures/ui/magnifyingGlass");
  form.button("Player\nStatus", "textures/ui/xbox4");
  form.button("UHC Player List", "textures/ui/servers");
  form.button("Team Stats", "textures/ui/icons/icon_spring");
  form.button("Death Locations", "textures/ui/icon_recipe_equipment");

  form.show(player).then((res) => {
    if (!res || res.canceled) return;

    switch (res.selection) {
      case 0:
        playerLists(player);
        break;
      case 1:
        killList(player);
        break;
      case 2:
        clearTeams(player);
        break;
      case 3:
        showTeleportForm(player);
        break;
      case 4:
        Managements(player);
        break;
      case 5:
        viewDynamicProperty(player);
        break;
      case 6:
        viewAllMaps(player);
        break;
      case 7:
        viewPlayerStatus(player);
        break;
      case 8:
        viewUhcPlayerList(player);
        break;
      case 9:
        viewTeamStats(player);
        break;
      case 10:
        viewDeathLocations(player);
        break;
    }
  });
}

// ======================================================
// Teleport To Spawn (เทเลพอร์ตไปยังจุดเกิด)
// ======================================================
function teleportToSpawn(player) {
  if (!player?.isValid) return;
  const dim = world.getDimension("overworld");
  const baseX = 596;
  const baseY = 123;
  const baseZ = 609;
  const spawn = {
    x: baseX + Math.floor(Math.random() * 5) - 2,
    y: baseY,
    z: baseZ + Math.floor(Math.random() * 5) - 2,
  };
  player.teleport(spawn, { dimension: dim });
  const tx = spawn.x;
  const ty = spawn.y;
  const tz = spawn.z;
  system.runTimeout(() => {
    if (!player?.isValid) return;
    player.playSound("random.enderchestopen", { volume: 0.9, pitch: 0.95 });
    try {
      dim.spawnParticle("so:light2", {
        x: tx,
        y: ty + 5,
        z: tz,
      });
    } catch {}
  }, 5);
}
// ======================================================
//
//                 MainMenu (เมนูหลัก)
//
// ======================================================
export function openMainMenu(player) {
  const form = new ActionFormData();
  form.title(CONFIG.title + "§6UHCRun");
  form.button("Spawn", "textures/ui/icons/icon_summer");
  form.button("Team", "textures/ui/icons/icon_multiplayer");

  if (player.hasTag(CONFIG.adminTag)) {
    form.button("Admin", "textures/ui/Add-Ons_Side-Nav_Icon_24x24");
  }

  form.show(player).then((res) => {
    if (!res || res.canceled) return;
    switch (res.selection) {
      case 0:
        teleportToSpawn(player);
        break;
      case 1:
        openTeamMenu(player);
        break;
      case 2:
        if (player.hasTag(CONFIG.adminTag)) AdminMenu(player);
        break;
    }
  });
}

// ======================================================
// Show Victory Message (ป้ายประกาศชนะ)
// ======================================================
export function showVictoryMessage(winnerTeamId, uhcTick = 0) {
  const teamInfo = TEAM_LOOKUP.get(winnerTeamId);
  if (!teamInfo) return;

  const teamStat = teamStats.get(winnerTeamId) ?? { kills: 0, deaths: 0 };
  let playerLine = "";
  for (const [playerId, ps] of playerStats.entries()) {
    const teamId = ps.teamId ?? playerTeamCache.get(playerId);
    if (teamId !== winnerTeamId) continue;
    const onlinePlayer = playerCache.get(playerId);
    const name = onlinePlayer?.isValid ? onlinePlayer.name : (ps.name ?? playerId);
    playerLine += `${teamInfo.color}${name} §7- §c${ps.kills} Kill\n`;
  }

  if (!playerLine) {
    playerLine = `§7No players\n`;
  }

  const totalSeconds = uhcTick;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  world.sendMessage(
    `\n` +
      `§7=======================================\n` +
      `§6      UHC RUN26 MATCH FINISHED\n` +
      `§7=======================================\n\n` +
      `§eVICTORY ${teamInfo.color}${teamInfo.name}§r\n\n` +
      `§ePLAYERS\n` +
      playerLine +
      `\n` +
      `§eSTATS\n` +
      `§7 » Total Kills: §c${teamStat.kills}\n` +
      `§7 » Match Time: §e${minutes}m ${seconds}s\n\n` +
      `§9 » Sleeplite SMP\n\n` +
      `§7=======================================\n\n`,
  );
}

// ======================================================
//  Get Player by Team (รับข้อมูลผู้เล่นตามทีม)
// ======================================================
const getPlayersByTeamBuf = [];

export function getPlayersByTeam(teamId) {
  if (!TEAM_LOOKUP.has(teamId)) return getPlayersByTeamBuf;

  const ids = teamPlayerIndex.get(teamId);
  if (!ids) return getPlayersByTeamBuf;

  getPlayersByTeamBuf.length = 0;
  for (const id of ids) {
    const player = playerCache.get(id);
    if (player?.isValid) {
      getPlayersByTeamBuf.push(player);
    } else {
      ids.delete(id);
    }
  }

  return getPlayersByTeamBuf;
}

// ======================================================
//  Refresh Player Caches (รีเฟรชแคชของผู้เล่น)
// ======================================================
export function refreshPlayerCaches() {
  const players = world.getPlayers();
  const pLen = players.length;

  allPlayersCache.length = 0;
  uhcPlayersCache.length = 0;
  allPlayersCacheIds.clear();
  uhcPlayerIds.clear();
  playerCache.clear();

  for (let i = 0; i < pLen; i++) {
    const p = players[i];
    if (!p?.isValid) continue;

    allPlayersCache.push(p);
    allPlayersCacheIds.add(p.id);
    playerCache.set(p.id, p);

    if (p.hasTag("uhc")) {
      uhcPlayersCache.push(p);
      uhcPlayerIds.add(p.id);
    }
  }

  rebuildTeamRuntimeState(players);
}

// ======================================================
//  Clear All player Nematags (รีเซ็ตระบบ ชื่อแท็ก)
// ======================================================
export function clearAllPlayerNametags() {
  const players = world.getPlayers();
  let index = 0;

  const task = system.runInterval(() => {
    for (let i = 0; i < 3 && index < players.length; i++) {
      const p = players[index++];

      if (!p || !p.isValid) continue;
      if (p.nameTag === p.name) continue;

      p.nameTag = p.name;
    }

    if (index >= players.length) {
      system.clearRun(task);
      console.warn("clearAllPlayerNametags");
    }
  }, 1);
}

// ======================================================
//  Reset Announcer (รีเซ็ตระบบ ประกาศ Kill Streak)
// ======================================================
export function resetAnnouncer() {
  multiKill.clear();
  killStreak.clear();
  firstBloodDone = false;

  const players = world.getPlayers(),
    pLen = players.length;

  for (let i = 0; i < pLen; i++) {
    const p = players[i];
    if (!p?.isValid) continue;

    if (p.nameTag.includes("\n§f")) {
      p.nameTag = p.name;
    }
  }

  console.warn("[UHC] Announcer System Reset.");
}

// ======================================================
//  Clear All TagUHC and DynamicProperty
// ======================================================
export function clearAllTaguhcAndDynamicProperty(executor) {
  if (executor && !executor.hasTag(CONFIG.adminTag)) return;

  refreshPlayerCaches();

  const players = allPlayersCache.length > 0 ? allPlayersCache : world.getPlayers(),
    pLen = players.length;

  const teamsLen = TEAMS.length;
  clearTeamRuntimeState();

  for (let i = 0; i < pLen; i++) {
    const player = players[i];
    if (!player?.isValid) continue;

    const teamId = playerTeamCache.get(player.id);
    if (teamId) player.removeTag(teamId);

    if (player.hasTag("uhc")) player.removeTag("uhc");

    player.setDynamicProperty(CONFIG.key, undefined);
    removePlayerFromRuntimeState(player.id, teamId, true);
  }

  hitRegistry.clear();
  deathLocation.clear();
  allPlayersCache.length = 0;
  uhcPlayersCache.length = 0;
  allPlayersCacheIds.clear();
  playerTeamCache.clear();

  itemVacuumQueue.length = 0;
  itemVacuumRunning = false;

  if (statsSaveTask !== null) {
    system.clearRun(statsSaveTask);
    statsSaveTask = null;
    statsDirty = false;
  }

  resetAnnouncer();

  for (let i = 0; i < teamsLen; i++) {
    teamStats.set(TEAMS[i].id, { kills: 0, deaths: 0 });
  }

  playerStats.clear();
  world.setDynamicProperty("uhc_teamStats", undefined);
  world.setDynamicProperty("uhc_playerStats", undefined);

  if (teamKillObj) {
    for (let i = 0; i < teamsLen; i++) {
      const label = `${TEAMS[i].color}${TEAMS[i].name}`;
      teamKillObj.removeParticipant(label);
    }
  }

  const board = getBoard();
  for (let i = 0; i < teamsLen; i++) {
    const entry = `${TEAMS[i].color}${TEAMS[i].name}`;
    board.removeParticipant(entry);
  }

  console.warn("[UHC] All tags, dynamic properties, and runtime states cleared.");
}

// ======================================================
// Reset Teams
// ======================================================
export function clearAllTeams(executor) {
  if (executor && !executor.hasTag(CONFIG.adminTag)) return;
  refreshPlayerCaches();

  const players = allPlayersCache.length > 0 ? allPlayersCache : world.getPlayers(),
    pLen = players.length,
    teamsLen = TEAMS.length;

  clearTeamRuntimeState();

  for (let i = 0; i < pLen; i++) {
    const player = players[i];
    if (!player?.isValid) continue;

    const cachedTeam = playerTeamCache.get(player.id);
    if (cachedTeam) player.removeTag(cachedTeam);

    player.setDynamicProperty(CONFIG.key, undefined);
    removePlayerFromRuntimeState(player.id, cachedTeam, false);
    player.nameTag = player.name;
  }

  const board = getBoard();
  for (let i = 0; i < teamsLen; i++) {
    const entry = `${TEAMS[i].color}${TEAMS[i].name}`;
    board.removeParticipant(entry);
  }
}

// ======================================================
// check Caches
// ======================================================
function checkAllCaches() {
  const cacheInfo = {
    teamCounts: teamCounts.size,
    playerTeamCache: playerTeamCache.size,
    teamPlayerIndex: teamPlayerIndex.size,
    playerCache: playerCache.size,
    uhcPlayerIds: uhcPlayerIds.size,
    allPlayersCache: allPlayersCache.length,
    allPlayersCacheIds: allPlayersCacheIds.size,
    uhcPlayersCache: uhcPlayersCache.length,
    teamStats: teamStats.size,
    playerStats: playerStats.size,
    deathLocation: deathLocation.size,
    multiKill: multiKill.size,
    killStreak: killStreak.size,
    hitRegistry: hitRegistry.size,
  };

  let message = "§e=== Cache Status ===§r\n";
  message += `§7teamCounts: §f${cacheInfo.teamCounts}\n`;
  message += `§7playerTeamCache: §f${cacheInfo.playerTeamCache}\n`;
  message += `§7teamPlayerIndex: §f${cacheInfo.teamPlayerIndex}\n`;
  message += `§7playerCache: §f${cacheInfo.playerCache}\n`;
  message += `§7uhcPlayerIds: §f${cacheInfo.uhcPlayerIds}\n`;
  message += `§7allPlayersCache: §f${cacheInfo.allPlayersCache}\n`;
  message += `§7allPlayersCacheIds: §f${cacheInfo.allPlayersCacheIds}\n`;
  message += `§7uhcPlayersCache: §f${cacheInfo.uhcPlayersCache}\n`;
  message += `§7teamStats: §f${cacheInfo.teamStats}\n`;
  message += `§7playerStats: §f${cacheInfo.playerStats}\n`;
  message += `§7deathLocation: §f${cacheInfo.deathLocation}\n`;
  message += `§7multiKill: §f${cacheInfo.multiKill}\n`;
  message += `§7killStreak: §f${cacheInfo.killStreak}\n`;
  message += `§7hitRegistry: §f${cacheInfo.hitRegistry}\n`;

  const totalSize = Object.values(cacheInfo).reduce((sum, val) => sum + val, 0);
  message += `§e=== Total: §c${totalSize} §eentries ===`;

  return { info: cacheInfo, message, totalSize };
}

// ======================================================
// ลบ Cache ทั้งหมด (ยกเว้น teamCounts และ playerTeamCache)
// ======================================================
function clearAllCaches() {
  const before = checkAllCaches();
  playerTeamCache.clear();

  // --- ล้างแคชขณะรันไทม์ ---
  playerCache.clear();
  uhcPlayerIds.clear();
  allPlayersCache.length = 0;
  uhcPlayersCache.length = 0;
  allPlayersCacheIds.clear();
  clearTeamRuntimeState();

  // --- ล้างแคชสถานะเกม ---
  deathLocation.clear();
  multiKill.clear();
  killStreak.clear();
  hitRegistry.clear();

  const after = checkAllCaches();

  const cleared = before.totalSize - after.totalSize;

  return {
    before: before.totalSize,
    after: after.totalSize,
    cleared: cleared,
    message: `[Cache] Cleared ${cleared} entries\n§7Before: ${before.totalSize} → After: ${after.totalSize}`,
  };
}

// ======================================================
// clear All Caches Inc luding Stats
// ======================================================
function clearAllCachesIncludingStats() {
  const before = checkAllCaches();
  playerTeamCache.clear();

  // --- ล้างแคชทั้งหมด ---
  playerCache.clear();
  uhcPlayerIds.clear();
  allPlayersCache.length = 0;
  uhcPlayersCache.length = 0;
  allPlayersCacheIds.clear();
  clearTeamRuntimeState();
  deathLocation.clear();
  multiKill.clear();
  killStreak.clear();
  hitRegistry.clear();

  // --- Clear stats ---
  const teamsLen = TEAMS.length;
  for (let i = 0; i < teamsLen; i++) {
    teamStats.set(TEAMS[i].id, { kills: 0, deaths: 0 });
  }
  playerStats.clear();

  // --- Clear dynamic properties ---
  world.setDynamicProperty("uhc_teamStats", undefined);
  world.setDynamicProperty("uhc_playerStats", undefined);

  const after = checkAllCaches();
  const cleared = before.totalSize - after.totalSize;

  return {
    before: before.totalSize,
    after: after.totalSize,
    cleared: cleared,
    message: `§a[Cache] Cleared ${cleared} entries (including stats)\n§7Before: ${before.totalSize} → After: ${after.totalSize}`,
  };
}

// ======================================================
//
//                 World Event
//
// ======================================================
world.beforeEvents.chatSend.subscribe(onChat);
world.afterEvents.entityDie.subscribe(onDeath);
world.afterEvents.entityHurt.subscribe(onHurt);
world.afterEvents.playerSpawn.subscribe(onSpawn);
world.afterEvents.playerLeave.subscribe(onLeave);

world.afterEvents.itemUse.subscribe((ev) => {
  const { source, itemStack } = ev;

  if (!source?.isValid) return;
  if (itemStack?.typeId !== "minecraft:compass") return;

  const isAdmin = source.hasTag(CONFIG.adminTag),
    isUhc = source.hasTag("uhc");

  if (!isAdmin && isUhc) return;

  system.run(() => openMainMenu(source));
});

system.run(() => {
  const players = world.getPlayers(),
    pLen = players.length;

  for (let i = 0; i < pLen; i++) {
    const p = players[i];
    if (!p?.isValid) continue;
    playerCache.set(p.id, p);
  }

  rebuildTeamRuntimeState(players);
  flushSidebarUpdates();
});

world.beforeEvents.chatSend.subscribe((ev) => {
  const player = ev.sender;
  if (!player?.isValid) return;

  const message = ev.message.toLowerCase();

  switch (message) {
    case "!เช็ค":
    case "!check":
      if (!player.hasTag(CONFIG.adminTag)) {
        player.sendMessage("§c[Cache] You don't have permission!");
        return;
      }
      ev.cancel = true;
      system.run(() => {
        const result = checkAllCaches();
        player.sendMessage(result.message);
        console.warn("[Cache Check]\n" + result.message.replace(/§./g, ""));
      });
      break;

    case "!ลบ":
    case "!clear":
      if (!player.hasTag(CONFIG.adminTag)) {
        player.sendMessage("§c[Cache] You don't have permission!");
        return;
      }
      ev.cancel = true;
      system.run(() => {
        const result = clearAllCaches();
        player.sendMessage(result.message);
        world.sendMessage(`§e[Cache] §f${player.name} §7cleared cache`);
        console.warn("[Cache Clear]\n" + result.message.replace(/§./g, ""));
      });
      break;

    case "!ลบทั้งหมด":
    case "!clearall":
      if (!player.hasTag(CONFIG.adminTag)) {
        player.sendMessage("§c[Cache] You don't have permission!");
        return;
      }
      ev.cancel = true;
      system.run(() => {
        const result = clearAllCachesIncludingStats();
        player.sendMessage(result.message);
        world.sendMessage(`§c[Cache] §f${player.name} §7cleared ALL cache (including stats)`);
        console.warn("[Cache Clear All]\n" + result.message.replace(/§./g, ""));
      });
      break;
  }
});

// ======================================================
// Export API
// ======================================================
export function getPlayerTeam(player) {
  if (!player?.isValid) return null;
  return playerTeamCache.get(player.id) ?? player.getDynamicProperty(CONFIG.key) ?? null;
}

export function getTeams() {
  return TEAMS;
}

export function getTeamInfo(teamId) {
  return TEAM_LOOKUP.get(teamId) ?? null;
}

export function getPlayerStats() {
  return playerStats;
}

export function getPlayerName(id) {
  return playerCache.get(id)?.name ?? null;
}

export function getTeamStats() {
  return teamStats;
}

export function getTeamKillObjective() {
  return teamKillObj;
}

export function getKdHistoryObjective() {
  return kdHistoryObj;
}

export function getAllPlayers() {
  return allPlayersCache;
}

export function getUhcPlayers() {
  return uhcPlayersCache;
}

export function isPlayerUhcId(id) {
  return uhcPlayerIds.has(id);
}

export function setGameRunningState(state) {
  isGameRunning = state;
}
