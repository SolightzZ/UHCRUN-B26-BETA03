import { world, system, DisplaySlotId, GameMode } from "@minecraft/server";
import { ActionFormData } from "@minecraft/server-ui";
import { dynamicToast } from "../plugin/Util";

let allPlayersCache = [],
  uhcPlayersCache = [],
  allPlayersCacheIds = new Set();

let aliveTeamDirtyHandler = () => {};

export function registerAliveTeamDirtyHandler(handler) {
  aliveTeamDirtyHandler = typeof handler === "function" ? handler : () => {};
}

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

export const CONFIG = Object.freeze({
  adminTag: "admin",
  comPass: "uhc",
  objectiveName: "uhcBoard",
  displayName: "UHC",
  title: "§g§r",
  // world save (DynamicProperty):
  // { "<player-uuid-1>" → "team1",
  // "<player-uuid-2>" → "team3" }
  // value เป็น string (teamId)
  key: "team",
});

// { "team1" → { id, name, color, icon }, }
const TEAM_LOOKUP = new Map(TEAMS.map((t) => [t.id, t]));

// { "team1" → 0, "team2" → 1 }
const TEAM_INDEX_MAP = new Map(TEAMS.map((t, i) => [t.id, i]));

// { "team1" → 3,  "team2" → 1 }
const teamCounts = new Map();
const teamPlayerIndex = new Map();

//  Scoreboard
let isGameRunning = false;
let cachedBoard;
let sidebarFlushTask = null;
const dirtySidebarTeams = new Set();

export function setGameRunningState(state) {
  isGameRunning = state;
}

export function refreshScoreboardUI() {
  if (isGameRunning) return;
  const board = getBoard();
  world.scoreboard.setObjectiveAtDisplaySlot(DisplaySlotId.Sidebar, { objective: board });

  const teamsLen = TEAMS.length;
  for (let i = 0; i < teamsLen; i++) {
    updateSidebar(TEAMS[i].id);
  }

  flushSidebarUpdates();
}

function getBoard() {
  if (cachedBoard) return cachedBoard;

  let board = world.scoreboard.getObjective(CONFIG.objectiveName);
  if (!board) {
    board = world.scoreboard.addObjective(CONFIG.objectiveName, CONFIG.displayName);
  }

  cachedBoard = board;
  return board;
}

function flushSidebarUpdates() {
  if (isGameRunning) return;

  const board = getBoard();
  for (const teamId of dirtySidebarTeams) {
    const team = TEAM_LOOKUP.get(teamId);
    if (!team) continue;

    const entry = `${team.color}${team.name}`,
      count = teamCounts.get(teamId) ?? 0;

    if (count <= 0) {
      board.removeParticipant(entry);
    } else {
      board.setScore(entry, count);
    }
  }

  dirtySidebarTeams.clear();
}

function updateSidebar(teamId) {
  if (isGameRunning || !TEAM_LOOKUP.has(teamId)) return;

  dirtySidebarTeams.add(teamId);
  if (sidebarFlushTask !== null) return;

  sidebarFlushTask = system.runTimeout(() => {
    sidebarFlushTask = null;
    flushSidebarUpdates();
  }, 1);
}

//  Core
function setTeam(player, teamId) {
  const oldTeamId = playerTeamCache.get(player.id) ?? null;

  if (oldTeamId === teamId) return;

  if (oldTeamId) {
    teamPlayerIndex.get(oldTeamId)?.delete(player.id);
  }

  if (teamId) {
    player.setDynamicProperty(CONFIG.key, teamId);
    playerTeamCache.set(player.id, teamId);

    if (shouldTrackTeamRuntime(player)) {
      teamPlayerIndex.get(teamId)?.add(player.id);
    }

    const teamIndex = (TEAM_INDEX_MAP.get(teamId) ?? -1) + 1,
      teamInfo = TEAM_LOOKUP.get(teamId);

    if (teamInfo) {
      player.nameTag = `[${teamIndex}] ${teamInfo.color}${player.name}`;
    }

    const ps = playerStats.get(player.id) ?? { kills: 0, deaths: 0 };
    ps.name = player.name;
    ps.teamId = teamId;
    playerStats.set(player.id, ps);
    scheduleSaveStats();
  } else {
    player.setDynamicProperty(CONFIG.key, undefined);
    playerTeamCache.delete(player.id);
    player.nameTag = player.name;
  }

  syncTag(player, oldTeamId, teamId ?? null);
  aliveTeamDirtyHandler();
}

function shouldTrackTeamRuntime(player) {
  return !isGameRunning || player?.hasTag("uhc");
}

function removeCachedPlayerById(list, id) {
  const index = list.findIndex((player) => player?.id === id);
  if (index === -1) return;
  // Swap-and-pop
  list[index] = list[list.length - 1];
  list.pop();
}

function removePlayerFromAliveRuntimeState(id, teamId = playerTeamCache.get(id) ?? null) {
  uhcPlayerIds.delete(id);
  removeCachedPlayerById(uhcPlayersCache, id);

  if (teamId && TEAM_LOOKUP.has(teamId)) {
    teamCounts.set(teamId, Math.max(0, (teamCounts.get(teamId) ?? 0) - 1));
    teamPlayerIndex.get(teamId)?.delete(id);
    updateSidebar(teamId);
  }

  aliveTeamDirtyHandler();
}

function syncTag(player, oldTeamId, newTeamId) {
  if (oldTeamId && oldTeamId !== newTeamId) {
    player.removeTag(oldTeamId);
  }
  if (newTeamId) {
    player.addTag(newTeamId);
  }
}

function joinTeam(player, newTeamId) {
  if (!TEAM_LOOKUP.has(newTeamId)) return;

  const oldTeam = getPlayerTeam(player);

  if (oldTeam === newTeamId) return;

  if (oldTeam && shouldTrackTeamRuntime(player)) {
    const beforeOld = teamCounts.get(oldTeam) ?? 0;
    teamCounts.set(oldTeam, Math.max(0, beforeOld - 1));
    updateSidebar(oldTeam);
  }

  if (shouldTrackTeamRuntime(player)) {
    const beforeNew = teamCounts.get(newTeamId) ?? 0;
    teamCounts.set(newTeamId, beforeNew + 1);
  }

  setTeam(player, newTeamId);
  if (shouldTrackTeamRuntime(player)) updateSidebar(newTeamId);
}

function leaveTeam(player) {
  const oldTeam = getPlayerTeam(player);
  if (!oldTeam) return;

  if (shouldTrackTeamRuntime(player)) {
    teamCounts.set(oldTeam, Math.max(0, (teamCounts.get(oldTeam) ?? 0) - 1));
  }
  setTeam(player, null);
  if (shouldTrackTeamRuntime(player)) updateSidebar(oldTeam);
}

// Kill And Death

const deathQueue = [];
let deathBatchRunning = false;

const BATCH_SIZE = 5;

function showDeathScreenshot(player, killer) {
  if (!player?.isValid) return;

  deathQueue.push({ player, killer });

  if (!deathBatchRunning) {
    deathBatchRunning = true;
    system.run(processDeathBatch);
  }
}

function processDeathBatch() {
  let count = 0;

  while (deathQueue.length > 0 && count < BATCH_SIZE) {
    const { player } = deathQueue.shift();
    if (!player?.isValid) continue;

    const resolvedKiller = resolveKiller(player.id);

    let killerDisplay = "the environment";

    if (resolvedKiller?.isValid) {
      const teamId = playerTeamCache.get(resolvedKiller.id);
      const team = teamId ? TEAM_LOOKUP.get(teamId) : null;

      killerDisplay = team ? `${team.color}${resolvedKiller.name}§r` : `${resolvedKiller.name}`;
    } else {
      const entry = hitRegistry.get(player.id);

      if (entry) {
        switch (entry.cause) {
          case "fall":
            killerDisplay = "fall damage";
            break;

          case "lava":
            killerDisplay = "lava";
            break;

          case "fire":
          case "fire_tick":
            killerDisplay = "fire";
            break;

          case "drowning":
            killerDisplay = "drowning";
            break;

          case "void":
            killerDisplay = "the void";
            break;

          case "explosion":
            killerDisplay = "explosion";
            break;

          case "projectile":
            killerDisplay = "shot";
            break;

          default:
            killerDisplay = "the environment";
        }
      }
    }

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

    const victimTeamId = playerTeamCache.get(player.id);
    const victimTeamInfo = victimTeamId ? TEAM_LOOKUP.get(victimTeamId) : null;
    const victimPs = playerStats.get(player.id) ?? { kills: 0, deaths: 0 };

    player.sendMessage(
      `\n` +
        `§7==========================\n` +
        `§c            YOU DIED\n` +
        `§7==========================\n\n` +
        `§eKilled by §r${killerDisplay}\n\n` +
        `§eSTATS\n` +
        `§7 » Kills: §c${victimPs.kills}\n` +
        `§7 » Deaths: §c${victimPs.deaths}\n\n` +
        `§9 » Sleeplite SMP\n\n` +
        `§7==========================\n\n`,
    );

    count++;
  }

  if (deathQueue.length > 0) {
    system.run(processDeathBatch);
  } else {
    deathBatchRunning = false;
  }
}

const KD = {
  scoreKillDeathHistory: "kdhistory",
  hitTimeoutSeconds: 8,
};

const HIT_TIMEOUT_TICKS = 20 * KD.hitTimeoutSeconds,
  MULTI_TIMEOUT = 20 * 16,
  // { "teamId" -> { kills: number, deaths: number } }
  teamStats = new Map(),
  playerStats = new Map(),
  deathLocation = new Map(),
  teamsLen = TEAMS.length;

let teamKillObj = null;

const GlobalPlayerCaches = new Map();

function ensureGPC(id) {
  let c = GlobalPlayerCaches.get(id);
  if (!c) {
    c = {};
    GlobalPlayerCaches.set(id, c);
  }
  return c;
}

function purgePlayerGlobalCache(id) {
  GlobalPlayerCaches.delete(id);
}
const createCacheProxy = (key) => {
  const proxy = {
    get: (id) => GlobalPlayerCaches.get(id)?.[key],
    set: (id, val) => {
      ensureGPC(id)[key] = val;
      return proxy;
    },
    delete: (id) => {
      const c = GlobalPlayerCaches.get(id);
      if (c) delete c[key];
      return true;
    },
    has: (id) => GlobalPlayerCaches.get(id)?.[key] !== undefined,
    entries: function* () {
      for (const [id, c] of GlobalPlayerCaches.entries()) if (c[key] !== undefined) yield [id, c[key]];
    },
    clear: () => {
      for (const c of GlobalPlayerCaches.values()) delete c[key];
    },
    get size() {
      let count = 0;
      for (const c of GlobalPlayerCaches.values()) if (c[key] !== undefined) count++;
      return count;
    },
  };
  return proxy;
};

const playerTeamCache = createCacheProxy("teamId");
const hitRegistry = createCacheProxy("hit");
const multiKill = createCacheProxy("multiKill");
const killStreak = createCacheProxy("killStreak");
const playerCache = createCacheProxy("playerRef");

const uhcPlayerIds = {
  has: (id) => GlobalPlayerCaches.get(id)?.isUhc === true,
  add: function (id) {
    ensureGPC(id).isUhc = true;
    return this;
  },
  delete: function (id) {
    const c = GlobalPlayerCaches.get(id);
    if (c) delete c.isUhc;
    return true;
  },
  clear: function () {
    for (const c of GlobalPlayerCaches.values()) delete c.isUhc;
  },
  get size() {
    let count = 0;
    for (const c of GlobalPlayerCaches.values()) if (c.isUhc === true) count++;
    return count;
  },
};

for (let i = 0; i < teamsLen; i++) {
  teamStats.set(TEAMS[i].id, { kills: 0, deaths: 0 });
}

let firstBloodDone = false;

const isUHC = (e) => e && uhcPlayerIds.has(e.id);

export function isPlayerUhcId(id) {
  return uhcPlayerIds.has(id);
}

function safeParseDynamicMap(rawValue, label) {
  if (typeof rawValue !== "string" || rawValue.length === 0) return null;

  try {
    const parsed = JSON.parse(rawValue);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      console.warn(`[UHC] Ignored invalid ${label} dynamic property payload.`);
      return null;
    }
    return parsed;
  } catch (error) {
    console.warn(`[UHC] Failed to parse ${label} dynamic property: ${error}`);
    return null;
  }
}

function clearTeamRuntimeState() {
  const teamsLen = TEAMS.length;
  for (let i = 0; i < teamsLen; i++) {
    const teamId = TEAMS[i].id;
    teamCounts.set(teamId, 0);
    teamPlayerIndex.set(teamId, new Set());
    updateSidebar(teamId);
  }
}

export function rebuildTeamRuntimeState(players) {
  playerTeamCache.clear();
  clearTeamRuntimeState();

  const pLen = players.length;
  for (let i = 0; i < pLen; i++) {
    const p = players[i];
    if (!p?.isValid) continue;

    const teamId = p.getDynamicProperty(CONFIG.key);
    if (typeof teamId !== "string" || !TEAM_LOOKUP.has(teamId)) continue;

    playerTeamCache.set(p.id, teamId);
    if (shouldTrackTeamRuntime(p)) {
      teamCounts.set(teamId, (teamCounts.get(teamId) ?? 0) + 1);
      teamPlayerIndex.get(teamId)?.add(p.id);
    }
  }
}

function removePlayerFromRuntimeState(id, teamId = playerTeamCache.get(id) ?? null, fullCleanup = false) {
  if (teamId && TEAM_LOOKUP.has(teamId)) {
    teamPlayerIndex.get(teamId)?.delete(id);
    teamCounts.set(teamId, Math.max(0, (teamCounts.get(teamId) ?? 0) - 1));
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

// Scoreboard Bootstrap
let kdHistoryObj = null;

function initScoreboard() {
  const sb = world.scoreboard;
  if (!sb) return;

  kdHistoryObj = sb.getObjective(KD.scoreKillDeathHistory) ?? sb.addObjective(KD.scoreKillDeathHistory, "KD History");
  teamKillObj = sb.getObjective("uhc_teamkills") ?? sb.addObjective("uhc_teamkills", "Team Kills");
}

system.run(initScoreboard);

function initStats() {
  const dTeam = world.getDynamicProperty("uhc_teamStats");
  const parsedTeamStats = safeParseDynamicMap(dTeam, "uhc_teamStats");
  if (parsedTeamStats) {
    const parsed = parsedTeamStats,
      entries = Object.entries(parsed),
      len = entries.length;

    for (let i = 0; i < len; i++) {
      const [k, v] = entries[i];
      if (teamStats.has(k)) {
        teamStats.set(k, { kills: Number(v.kills) || 0, deaths: Number(v.deaths) || 0 });
      }
    }
  }

  const dPlayer = world.getDynamicProperty("uhc_playerStats");
  const parsedPlayerStats = safeParseDynamicMap(dPlayer, "uhc_playerStats");
  if (parsedPlayerStats) {
    const parsed = parsedPlayerStats,
      entries = Object.entries(parsed),
      len = entries.length;

    for (let i = 0; i < len; i++) {
      const [k, v] = entries[i];
      playerStats.set(k, {
        kills: Number(v.kills) || 0,
        deaths: Number(v.deaths) || 0,
        name: v.name ?? undefined,
        teamId: v.teamId ?? undefined,
      });
    }
  }
}

system.run(initStats);

let statsDirty = false;
let statsSaveTask = null;

function scheduleSaveStats() {
  statsDirty = true;
  if (statsSaveTask !== null) return;

  statsSaveTask = system.runTimeout(() => {
    statsSaveTask = null;
    if (!statsDirty) return;
    statsDirty = false;

    try {
      world.setDynamicProperty("uhc_teamStats", JSON.stringify(Object.fromEntries(teamStats)));
    } catch (e) {
      console.warn("[UHC] saveStats teamStats failed:", e);
    }

    system.runTimeout(() => {
      try {
        world.setDynamicProperty("uhc_playerStats", JSON.stringify(Object.fromEntries(playerStats)));
      } catch (e) {
        console.warn("[UHC] saveStats playerStats failed:", e);
      }
    }, 2);
  }, 60);
}

// Score Helper (Single Objective)
function incrementPairHistory(killer, victim) {
  if (!kdHistoryObj) return;

  const historyKey = `Kill: ${killer.name} | Victim : ${victim.name}`;
  kdHistoryObj.addScore(historyKey, 1);
}

// Hit Tracking
function trackHit(attacker, victim, cause) {
  if (!victim || attacker === victim) return;

  const existing = hitRegistry.get(victim.id);

  const entry = {
    attackerId: attacker?.id ?? null,
    cause: cause ?? "unknown",
    tick: system.currentTick,
  };

  if (existing) {
    existing.attackerId = entry.attackerId;
    existing.cause = entry.cause;
    existing.tick = entry.tick;
  } else {
    hitRegistry.set(victim.id, entry);
  }
}

// Memory Cleanup for hitRegistry
system.runInterval(() => {
  const currentTick = system.currentTick;
  for (const [victimId, entry] of hitRegistry.entries()) {
    if (currentTick - entry.tick > HIT_TIMEOUT_TICKS) {
      hitRegistry.delete(victimId);
    }
  }
}, 200);

function resolveKiller(victimId) {
  const entry = hitRegistry.get(victimId);
  if (!entry) return null;

  if (system.currentTick - entry.tick > HIT_TIMEOUT_TICKS) {
    hitRegistry.delete(victimId);
    return null;
  }

  const killer = playerCache.get(entry.attackerId);
  return killer?.isValid ? killer : null;
}

// First Blood & MultiKill & Announcer System
const MULTI_KILL_DATA = [
  null,
  { text: "§eKILL", sound: "kill1" },
  { text: "§6DOUBLE KILL", sound: "kill2" },
  { text: "§cTRIPLE KILL", sound: "kill3" },
  { text: "§5QUADRA KILL", sound: "kill4" },
  { text: "§4ACE", sound: "kill5" },
];

function handleMultiKill(killer) {
  if (!killer?.isValid) return;

  const id = killer.id,
    now = system.currentTick;

  let data = multiKill.get(id);

  if (!data || now - data.tick > MULTI_TIMEOUT) {
    data = { count: 1, tick: now };
    multiKill.set(id, data);
  } else {
    data.count++;
    data.tick = now;
  }

  const count = Math.min(data.count, 5),
    info = MULTI_KILL_DATA[count];

  if (!info) return;

  const message = `${info.text} §7| §f${killer.name}`;

  world.sendMessage(dynamicToast(message, "textures/ui/icons/icon_multiplayer"));

  killer.playSound(info.sound);
}

function handleKillStreak(killer) {
  if (!killer?.isValid) return;
  const streak = (killStreak.get(killer.id) ?? 0) + 1;
  killStreak.set(killer.id, streak);
}

function handleFirstBlood(killer, victim) {
  if (!killer?.isValid || !victim?.isValid) return;
  if (firstBloodDone) return;

  firstBloodDone = true;

  const message = `§cFIRST BLOOD §7| ${killer.name} > §f${victim.name}`;
  world.sendMessage(dynamicToast(message, "textures/ui/friend_glyph_desaturated"));

  killer.playSound("mob.wither.death");
}

// Death Handler
const particleLocPool = { x: 0, y: 0, z: 0 },
  teleportLocPool = { x: 0, y: 0, z: 0 },
  spawnEntityLocPool = { x: 0, y: 0, z: 0 },
  entityQueryOptions = {
    type: "minecraft:item",
    location: { x: 0, y: 0, z: 0 },
    maxDistance: 16,
  },
  soundOptionsOrb = { pitch: 0.6, volume: 0.4 },
  soundOptionsEnderchest = { volume: 0.9, pitch: 0.95 },
  effectOptionsConduit = { amplifier: 255, showParticles: false };

// Death Handler
const itemVacuumQueue = [];
let itemVacuumRunning = false;

function drainItemVacuumQueue() {
  if (itemVacuumQueue.length === 0) {
    itemVacuumRunning = false;
    return;
  }
  itemVacuumRunning = true;
  const job = itemVacuumQueue.shift();
  system.runTimeout(() => {
    job();
    drainItemVacuumQueue();
  }, 3);
}

function enqueueItemVacuum(job) {
  itemVacuumQueue.push(job);
  if (!itemVacuumRunning) drainItemVacuumQueue();
}

function processVictimDeath(player, victimTeamId, loc) {
  removePlayerFromAliveRuntimeState(player.id, victimTeamId);
  if (!loc) return;

  const dim = player.dimension;

  deathLocation.set(player.id, { x: loc.x, y: loc.y, z: loc.z });

  particleLocPool.x = loc.x;
  particleLocPool.y = loc.y + 4.5;
  particleLocPool.z = loc.z;
  dim.spawnParticle("so:light2", particleLocPool);

  particleLocPool.y = loc.y + 6.5;
  dim.spawnParticle("so:light5", particleLocPool);

  const snapX = loc.x;
  const snapY = loc.y;
  const snapZ = loc.z;

  system.runTimeout(() => {
    if (!player?.isValid) return;
    player.removeTag("uhc");
    player.setGameMode(GameMode.Spectator);

    enqueueItemVacuum(() => {
      spawnEntityLocPool.x = snapX;
      spawnEntityLocPool.y = snapY + 0.2;
      spawnEntityLocPool.z = snapZ;
      const cart = dim.spawnEntity("minecraft:hopper_minecart", spawnEntityLocPool);
      const cartLoc = cart.location;

      entityQueryOptions.location.x = snapX;
      entityQueryOptions.location.y = snapY;
      entityQueryOptions.location.z = snapZ;
      const items = dim.getEntities(entityQueryOptions),
        itemLen = items.length;

      for (let i = 0; i < itemLen; i++) {
        const item = items[i];
        if (item?.isValid) {
          item.teleport(cartLoc, { dimension: dim });
        }
      }
    });
  }, 5);

  const victimPs = playerStats.get(player.id) ?? { kills: 0, deaths: 0 };
  victimPs.deaths++;
  victimPs.name = player.name;
  if (victimTeamId) victimPs.teamId = victimTeamId;
  playerStats.set(player.id, victimPs);

  const teamEntry = teamStats.get(victimTeamId);
  if (teamEntry) teamEntry.deaths++;

  scheduleSaveStats();
}

function processKillerRewards(killer, victimPlayer, victimTeamId) {
  const killerTeamId = playerTeamCache.get(killer.id);

  if (killerTeamId && killerTeamId === victimTeamId) {
    hitRegistry.delete(victimPlayer.id);
    return;
  }

  incrementPairHistory(killer, victimPlayer);

  const killerPs = playerStats.get(killer.id) ?? { kills: 0, deaths: 0 };
  killerPs.kills++;
  killerPs.name = killer.name;
  if (killerTeamId) killerPs.teamId = killerTeamId;
  playerStats.set(killer.id, killerPs);

  const teamEntry = teamStats.get(killerTeamId);
  if (teamEntry) teamEntry.kills++;

  if (teamKillObj && killerTeamId) {
    const info = TEAM_LOOKUP.get(killerTeamId);
    if (info) {
      const label = `${info.color}${info.name}`;
      teamKillObj.addScore(label, 1);
    }
  }

  scheduleSaveStats();

  handleFirstBlood(killer, victimPlayer);
  handleMultiKill(killer);
  handleKillStreak(killer);
}

// entity Hurt
function onHurt(ev) {
  const { hurtEntity, damageSource } = ev;
  if (hurtEntity?.typeId !== "minecraft:player") return;

  const attacker = damageSource?.damagingEntity;
  const cause = damageSource?.cause;

  if (attacker?.typeId === "minecraft:player" && isUHC(attacker) && isUHC(hurtEntity)) {
    trackHit(attacker, hurtEntity, cause);
  } else {
    trackHit(null, hurtEntity, cause);
  }
}

// entity Die
function onDeath(ev) {
  const dead = ev.deadEntity;
  if (dead?.typeId === "minecraft:player" && dead.isValid) {
    handleDeath(dead);
  }
}

function handleDeath(player) {
  if (!player?.isValid) return;

  const victimTeamId = playerTeamCache.get(player.id),
    killer = resolveKiller(player.id);

  // Victim
  if (isUHC(player)) {
    processVictimDeath(player, victimTeamId, player.location);
    killStreak.set(player.id, 0);
    multiKill.delete(player.id);

    showDeathScreenshot(player, killer);
  }

  // Killer
  if (killer && isUHC(killer) && killer !== player) {
    processKillerRewards(killer, player, victimTeamId);
  }

  hitRegistry.delete(player.id);
}

// player Spawn
function onSpawn(ev) {
  const player = ev.player;
  if (!player) return;

  playerCache.set(player.id, player);

  const spawnPs = playerStats.get(player.id) ?? { kills: 0, deaths: 0 };
  spawnPs.name = player.name;
  const spawnTeamId = playerTeamCache.get(player.id) ?? player.getDynamicProperty(CONFIG.key);
  if (spawnTeamId) spawnPs.teamId = spawnTeamId;
  playerStats.set(player.id, spawnPs);
  scheduleSaveStats();
  if (!allPlayersCacheIds.has(player.id)) {
    allPlayersCache.push(player);
    allPlayersCacheIds.add(player.id);
  }
  if (player.hasTag("uhc") && !uhcPlayerIds.has(player.id)) {
    uhcPlayersCache.push(player);
    uhcPlayerIds.add(player.id);
  }
  if (!ev.initialSpawn) {
    const loc = deathLocation.get(player.id);
    if (loc) {
      const dimension = player.dimension ?? world.getDimension("overworld");
      teleportLocPool.x = loc.x + 0.5;
      teleportLocPool.y = loc.y;
      teleportLocPool.z = loc.z + 0.5;
      player.teleport(teleportLocPool, { dimension });
      deathLocation.delete(player.id);
    }
  }

  const rawProp = player.getDynamicProperty(CONFIG.key),
    propertyTeam = typeof rawProp === "string" ? rawProp : null,
    cachedTeam = playerTeamCache.get(player.id),
    dynamicTeam = propertyTeam ?? cachedTeam;

  if (isGameRunning && !player.hasTag("uhc")) {
    player.setGameMode(GameMode.Spectator);
    player.addEffect("conduit_power", 1, effectOptionsConduit);
    return;
  }

  if (!dynamicTeam) return;

  const inCache = playerTeamCache.has(player.id);
  if (!inCache && shouldTrackTeamRuntime(player)) {
    const before = teamCounts.get(dynamicTeam) ?? 0;
    teamCounts.set(dynamicTeam, before + 1);
    updateSidebar(dynamicTeam);
  }

  setTeam(player, dynamicTeam);
}

//  player Leave
function onLeave(ev) {
  const id = ev.playerId;
  if (!id) return;

  const teamId = playerTeamCache.get(id),
    countedTeamId = !isGameRunning || uhcPlayerIds.has(id) ? teamId : null;
  removePlayerFromRuntimeState(id, countedTeamId, true);

  const idx1 = allPlayersCache.findIndex((p) => p.id === id);
  if (idx1 !== -1) {
    allPlayersCache[idx1] = allPlayersCache[allPlayersCache.length - 1];
    allPlayersCache.pop();
  }
  allPlayersCacheIds.delete(id);
  const idx2 = uhcPlayersCache.findIndex((p) => p.id === id);
  if (idx2 !== -1) {
    uhcPlayersCache[idx2] = uhcPlayersCache[uhcPlayersCache.length - 1];
    uhcPlayersCache.pop();
  }

  if (itemVacuumQueue.length > 0) {
    deathLocation.delete(id);
  }

  aliveTeamDirtyHandler();
  purgePlayerGlobalCache(id);
}

// chat Send
function onChat(ev) {
  const player = ev.sender;
  if (!player?.isValid) return;

  if (ev.message.startsWith("!")) return;

  const teamId = playerTeamCache.get(player.id);
  if (!teamId) return;

  const teamIndex = (TEAM_INDEX_MAP.get(teamId) ?? -1) + 1,
    teamInfo = TEAM_LOOKUP.get(teamId);

  if (!teamInfo) return;

  ev.cancel = true;
  const formattedMessage = `[${teamIndex}] ${teamInfo.color}${player.name}§r: ${ev.message}`;
  world.sendMessage(formattedMessage);
}

// Action Form Data
function openTeamMenu(player) {
  const form = new ActionFormData();
  form.title(CONFIG.title + "Team Manager");
  const currentTeamId = getPlayerTeam(player),
    currentTeam = currentTeamId ? TEAM_LOOKUP.get(currentTeamId) : null,
    teamDisplay = currentTeam ? `${currentTeam.color}${currentTeam.name}` : "Team?";

  form.body(`§f${player.name}: ${teamDisplay}`);

  const teamsLen = TEAMS.length;
  for (let i = 0; i < teamsLen; i++) {
    form.button(`${TEAMS[i].color}${TEAMS[i].name}`, TEAMS[i].icon);
  }

  form.button("§cLeave", "textures/ui/permissions_visitor_hand");
  form.button("§6Refresh", "textures/ui/refresh_light");
  form.button("§7Close", "textures/ui/cancel");
  form.show(player).then((res) => {
    if (!res || res.canceled) return;

    const selection = res.selection;

    if (selection < TEAMS.length) {
      const selectedTeam = TEAMS[selection];
      if (currentTeamId === selectedTeam.id) {
        player.playSound("note.bassattack");
        const message = `§oAlready`;
        player.sendMessage(dynamicToast(message, selectedTeam.icon));
      } else {
        joinTeam(player, selectedTeam.id);
        try {
          particleLocPool.x = player.location.x;
          particleLocPool.y = player.location.y + 1;
          particleLocPool.z = player.location.z;
          player.dimension.spawnParticle(selectedTeam.id, particleLocPool);
        } catch {}
        player.playSound("random.orb", soundOptionsOrb);
        const message = `Joined ${selectedTeam.color}${selectedTeam.name}`;
        player.sendMessage(dynamicToast(message, selectedTeam.icon));
      }
      system.run(() => openTeamMenu(player));
      return;
    }

    const actionIndex = selection - TEAMS.length;

    switch (actionIndex) {
      case 0:
        if (!currentTeamId) {
          player.playSound("note.bassattack");
          player.sendMessage(dynamicToast("§cYou have no team", "textures/ui/cancel"));
        } else {
          leaveTeam(player);
          player.playSound("random.break");
          player.sendMessage(dynamicToast(`§c§oLeft from ${currentTeam.color}${currentTeam.name}`, "textures/ui/permissions_visitor_hand"));
        }
        system.run(() => openTeamMenu(player));
        break;
      case 1:
        system.run(() => openTeamMenu(player));
        break;
      case 2:
        break;
    }
  });
}

// Admin Menu
function playerLists(player) {
  if (!player?.isValid) return;
  refreshPlayerCaches();
  const form = new ActionFormData().title("Player List"),
    players = getCachedPlayers(),
    pLen = players.length;

  let count = 0;

  for (let i = 0; i < pLen; i++) {
    const p = players[i];
    if (!p?.isValid) continue;
    const team = TEAM_LOOKUP.get(playerTeamCache.get(p.id));
    form.button(team ? `${p.name} §8| ${team.color}${team.name}§r` : `${p.name} | No Team`, team ? team.icon : "textures/ui/world_glyph_desaturated");
    count++;
  }

  if (count === 0) {
    form.body("No players online.");
  }
  const backIndex = count;
  form.button("Back");
  form.show(player).then((res) => {
    if (!res || res.canceled) return;
    switch (res.selection) {
      case backIndex:
        AdminMenu(player);
        break;
    }
  });
}

function killList(player) {
  if (!player?.isValid || !kdHistoryObj) return;
  const participants = kdHistoryObj.getParticipants() ?? [],
    totals = new Map();

  let history = "";
  const pLen = participants.length;

  for (let i = 0; i < pLen; i++) {
    const p = participants[i],
      score = kdHistoryObj.getScore(p);

    if (!score) continue;
    const key = p.displayName,
      parts = key.split(" | Victim : ");

    if (parts.length !== 2) continue;
    const killer = parts[0].replace("Kill: ", "");
    if (!killer) continue;
    history += `§7${key} §8= §c${score}\n`;
    totals.set(killer, (totals.get(killer) ?? 0) + score);
  }
  const form = new ActionFormData().title("Kill Death History");

  if (!history) {
    form.body("History is empty.");
    form.button("Console");
    form.button("Back", "textures/ui/arrow_left_white");
    return form.show(player).then((res) => {
      if (!res || res.canceled) return;
      switch (res.selection) {
        case 0:
          console.warn("[KD] History is empty.");
          break;
      }
      AdminMenu(player);
    });
  }

  let body = "§f=== TOTAL KILLS ===\n";
  const sortedTotals = [...totals.entries()].sort((a, b) => b[1] - a[1]),
    sLen = sortedTotals.length;

  for (let i = 0; i < sLen; i++) {
    const [killer, total] = sortedTotals[i];
    body += `§7${killer} §8= §c${total}\n`;
  }
  body += "\n§f=== HISTORY ===\n" + history.trimEnd();
  const plain = body.replace(/§./g, "");
  form.body(body);
  form.button("Console", "textures/ui/icons/icon_fall");
  form.button("Back");
  form.show(player).then((res) => {
    if (!res || res.canceled) return;
    switch (res.selection) {
      case 0:
        console.warn("[KD] Dump:\n" + plain);
        break;
    }
    AdminMenu(player);
  });
}

// clear Teams
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

// Teleport System
const TP_MODE = {
  admin: {
    doTeleport: (source, target) => {
      if (!source?.isValid || !target?.isValid) return;
      const loc = target.location;
      if (!loc) return;
      teleportLocPool.x = loc.x;
      teleportLocPool.y = loc.y;
      teleportLocPool.z = loc.z;
      source.teleport(teleportLocPool, { dimension: target.dimension ?? world.getDimension("overworld") });
      source.sendMessage(`§a[/] Teleported to §f${target.name}`);
    },
    getBackFn: () => AdminMenu,
    requireAdmin: true,
  },
  tpa: {
    doTeleport: (source, target) => {
      if (!target?.isValid) {
        source.sendMessage("§cTarget player is no longer online or alive.");
        return;
      }
      source.teleport(target.location, { dimension: target.dimension });
      source.playSound("teleport.ender_pearl");
      source.sendMessage(`§aTeleported to §f${target.name}`);
    },
    getBackFn: () => null,
    requireAdmin: false,
  },
};

// Teleport Hub
function showTeleportHub(player, mode) {
  if (!player?.isValid) return;
  if (mode.requireAdmin && !player.hasTag(CONFIG.adminTag)) return;
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
    if (tid) teamCountLocal.set(tid, (teamCountLocal.get(tid) ?? 0) + 1);
  }

  for (let i = 0; i < TEAMS.length; i++) {
    const team = TEAMS[i],
      count = teamCountLocal.get(team.id) ?? 0;
    if (count > 0) {
      form.button(`${team.color}${team.name} §8(${count})`, team.icon);
      buttonMap.push({ type: "team", teamId: team.id });
    }
  }

  const backFn = mode.getBackFn();
  if (backFn) {
    form.button("Back");
    buttonMap.push({ type: "back" });
  }

  form.show(player).then((res) => {
    if (!res || res.canceled) return;
    const action = buttonMap[res.selection];
    if (!action) return;
    switch (action.type) {
      case "random":
        tp_random(player, mode);
        break;
      case "all":
        tp_showAllPlayers(player, mode);
        break;
      case "team":
        tp_showTeamPlayers(player, action.teamId, mode);
        break;
      case "back":
        backFn?.(player);
        break;
    }
  });
}

// Tpa random
function tp_random(player, mode) {
  const candidates = getOtherUhcPlayers(player.id);
  if (candidates.length === 0) {
    player.sendMessage("§c[x] No valid UHC players.");
    return;
  }
  mode.doTeleport(player, candidates[(Math.random() * candidates.length) | 0]);
}

function tp_showAllPlayers(player, mode) {
  refreshPlayerCaches();
  const others = getOtherUhcPlayers(player.id),
    form = new ActionFormData();
  form.title("All UHC Players");

  if (others.length === 0) {
    form.body("No available players.");
    form.button("Back");
    return form.show(player).then(() => showTeleportHub(player, mode));
  }

  for (let i = 0; i < others.length; i++) {
    const p = others[i],
      team = TEAM_LOOKUP.get(playerTeamCache.get(p.id)),
      label = team ? `${team.color}${p.name} §8| ${team.name}` : `${p.name} §8| No Team`;
    form.button(label, team?.icon ?? "textures/ui/world_glyph_desaturated");
  }
  form.button("Back");

  form.show(player).then((res) => {
    if (!res || res.canceled) return;
    if (res.selection === others.length) return showTeleportHub(player, mode);
    const target = others[res.selection];
    if (!target?.isValid) return;
    mode.doTeleport(player, target);
  });
}

function tp_showTeamPlayers(player, teamId, mode) {
  refreshPlayerCaches();
  const team = TEAM_LOOKUP.get(teamId);
  if (!team) return showTeleportHub(player, mode);

  const teamPlayers = getOtherUhcPlayers(player.id).filter((p) => playerTeamCache.get(p.id) === teamId),
    form = new ActionFormData();
  form.title(`${team.color}${team.name} Team`);

  if (teamPlayers.length === 0) {
    form.body("No available players.");
    form.button("Back");
    return form.show(player).then(() => showTeleportHub(player, mode));
  }

  for (let i = 0; i < teamPlayers.length; i++) {
    form.button(`${team.color}${teamPlayers[i].name}`, team.icon);
  }
  form.button("Back");

  form.show(player).then((res) => {
    if (!res || res.canceled) return;
    if (res.selection === teamPlayers.length) return showTeleportHub(player, mode);
    const target = teamPlayers[res.selection];
    if (!target?.isValid) return;
    mode.doTeleport(player, target);
  });
}

function telePorts(admin) {
  showTeleportHub(admin, TP_MODE.admin);
}

function safeTeleport(admin, target) {
  TP_MODE.admin.doTeleport(admin, target);
}

function randomTeleport(admin) {
  tp_random(admin, TP_MODE.admin);
}

// --- TPA ---
export function tpa(player) {
  if (!player?.isValid) return;
  if (!isGameRunning) return;
  if (player.hasTag("uhc") && !player.hasTag(CONFIG.adminTag)) {
    player.sendMessage("§cYou cannot use TPA while alive in UHC!");
    return;
  }
  showTeleportHub(player, TP_MODE.tpa);
}

// Managemen Team
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

//  Edit Player
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

// Dump Viewer
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

// view Dynamic Property
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
      } catch {
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

// view Player Status
function viewPlayerStatus(admin) {
  if (!admin?.isValid) return;
  refreshPlayerCaches();
  const players = getCachedPlayers();
  let body = "";
  for (let i = 0; i < players.length; i++) {
    const p = players[i];
    if (!p?.isValid) continue;
    const gm = p.getGameMode ? p.getGameMode() : "Unknown",
      health = p.getComponent("minecraft:health") || p.getComponent("health"),
      hp = health && health.currentValue ? health.currentValue.toFixed(1) : "?";
    body += `§e${p.name} §8| GM: §7${gm} §8| HP: §c${hp}\n`;
  }
  showDumpViewer(admin, "Player Status Viewer", body, "PLAYER STATUS DUMP");
}

// view Uhc Player List
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

// view Team Stats
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

// view Death Locations
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

// Admin Menu
const ADMIN_HANDLERS = [
  playerLists,
  killList,
  clearTeams,
  telePorts,
  Managements,
  viewDynamicProperty,
  viewAllMaps,
  viewPlayerStatus,
  viewUhcPlayerList,
  viewTeamStats,
  viewDeathLocations,
];

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
    const handler = ADMIN_HANDLERS[res.selection];
    if (handler) handler(player);
  });
}

// Main Men
const spawnLocPool = { x: 0, y: 0, z: 0 };

function getRandomSpawn() {
  const baseX = 596,
    baseY = 123,
    baseZ = 609,
    offsetX = Math.floor(Math.random() * 5) - 2,
    offsetZ = Math.floor(Math.random() * 5) - 2;

  spawnLocPool.x = baseX + offsetX;
  spawnLocPool.y = baseY;
  spawnLocPool.z = baseZ + offsetZ;
  return spawnLocPool;
}

function teleportToSpawn(player) {
  if (!player?.isValid) return;
  const dim = world.getDimension("overworld"),
    spawn = getRandomSpawn();

  player.teleport(spawn, { dimension: dim });

  const tx = spawn.x,
    ty = spawn.y,
    tz = spawn.z;

  system.runTimeout(() => {
    if (!player?.isValid) return;
    player.playSound("random.enderchestopen", soundOptionsEnderchest);
    try {
      particleLocPool.x = tx;
      particleLocPool.y = ty + 5;
      particleLocPool.z = tz;
      dim.spawnParticle("so:light2", particleLocPool);
    } catch {}
  }, 5);
}

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

// System Run
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

// --------- Export API ----------

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

// --- Get Player by Team ---
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

// --- Refresh Player Caches ---
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

export function getAllPlayers() {
  return allPlayersCache;
}

export function getUhcPlayers() {
  return uhcPlayersCache;
}

// --- Clear All player Nematags ---
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

// --- Reset Announcer System ---
export function resetAnnouncerSystem() {
  multiKill.clear();
  killStreak.clear();
  firstBloodDone = false;

  const players = world.getPlayers(),
    pLen = players.length;

  for (let i = 0; i < pLen; i++) {
    const p = players[i];
    if (!p?.isValid) continue;

    p.onScreenDisplay.setActionBar("");

    if (p.nameTag.includes("\n§f")) {
      p.nameTag = p.name;
    }
  }

  console.warn("[UHC] Announcer System Reset.");
}

//  --- Clear All Tag UHC Dynamic Property ---
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

  resetAnnouncerSystem();

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

// --- Clear All Teams
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

//  Cache Management System
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

// ลบ Cache ทั้งหมด (ยกเว้น teamCounts และ playerTeamCache)
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

// ลบ Cache ทั้งหมดรวมถึง Stats
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

//  Chat Commands for Cache Management
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

export function getCacheStatus() {
  return checkAllCaches();
}

export function clearCaches() {
  return clearAllCaches();
}

export function clearCachesWithStats() {
  return clearAllCachesIncludingStats();
}
