import { system, world } from "@minecraft/server";
import { formatPlayerCache, addToCache, removeFromCache } from "./DataHelpers";

export const TEAMS = Object.freeze([
  { tag: "team1", name: "Red", color: "§c", icon: "textures/items/dye_powder_red" },
  { tag: "team2", name: "Blue", color: "§9", icon: "textures/items/dye_powder_blue_new" },
  { tag: "team3", name: "Yellow", color: "§e", icon: "textures/items/dye_powder_yellow" },
  { tag: "team4", name: "Green", color: "§a", icon: "textures/items/dye_powder_lime" },
  { tag: "team5", name: "Purple", color: "§5", icon: "textures/items/dye_powder_purple" },
  { tag: "team6", name: "Aqua", color: "§b", icon: "textures/items/dye_powder_light_blue" },
  { tag: "team7", name: "Orange", color: "§6", icon: "textures/items/dye_powder_orange" },
  { tag: "team8", name: "Gray", color: "§7", icon: "textures/items/dye_powder_silver" },
  { tag: "team9", name: "Pink", color: "§d", icon: "textures/items/dye_powder_pink" },
]);

// ===== Runtime Player Data =====
const playerStore = new Map();
let allPlayersCache = [];
let uhcPlayersCache = [];

function ensurePlayer(playerId) {
  if (!playerStore.has(playerId)) {
    playerStore.set(playerId, {});
  }
  return playerStore.get(playerId);
}

export const RUNTIME_KEY = {
  HIT_COUNT: "hitCount",
  MULTI_KILL: "multiKill",
  KILL_STREAK: "killStreak",
  DEATH_LOCATION: "deathLocation",
  LAST_DAMAGE: "lastDamage",
};

export const RuntimeStore = {
  get(playerId, dataKey, defaultValue) {
    return playerStore.get(playerId)?.[dataKey] ?? defaultValue;
  },

  set(playerId, dataKey, dataValue) {
    ensurePlayer(playerId)[dataKey] = dataValue;
  },

  delete(playerId, dataKey) {
    const playerData = playerStore.get(playerId);
    if (playerData) delete playerData[dataKey];
  },

  has(playerId, dataKey) {
    const playerData = playerStore.get(playerId);
    if (!playerData) return false;

    return Object.prototype.hasOwnProperty.call(playerData, dataKey);
  },

  clearKey(dataKey) {
    for (const playerData of playerStore.values()) {
      delete playerData[dataKey];
    }
  },

  countKey(dataKey) {
    let count = 0;
    for (const playerData of playerStore.values()) {
      if (dataKey in playerData) count++;
    }
    return count;
  },

  entryKey(dataKey) {
    const result = [];
    for (const [playerId, playerData] of playerStore) {
      if (dataKey in playerData) {
        result.push([playerId, playerData[dataKey]]);
      }
    }
    return result;
  },

  remove(playerId) {
    playerStore.delete(playerId);
  },
};

// ===== Persistent Player Data =====
const DEFAULT_STATS = {
  name: "",
  teamId: null,
  playTime: 0,
  kills: 0,
  deaths: 0,
  isUhc: false,
  isAlive: false,
};

let worldPropertyStore = null;

function loadStore() {
  if (worldPropertyStore) return worldPropertyStore;

  const raw = world.getDynamicProperty("UhcPlayerworldProperty");

  if (!raw) {
    worldPropertyStore = {};
    return worldPropertyStore;
  }

  try {
    worldPropertyStore = JSON.parse(raw);
  } catch (e) {
    console.warn("[STORE] JSON parse failed, resetting store:", e);
    worldPropertyStore = {};
  }

  return worldPropertyStore;
}

function saveStore() {
  if (!worldPropertyStore) return;

  try {
    const json = JSON.stringify(worldPropertyStore);
    world.setDynamicProperty("UhcPlayerworldProperty", json);
  } catch (e) {
    console.warn("[STORE] save failed:", e);
  }
}

function getWorldProperty(playerId) {
  const dataStore = loadStore();

  let playerStats = dataStore[playerId];
  if (!playerStats) {
    playerStats = Object.assign({}, DEFAULT_STATS);
    dataStore[playerId] = playerStats;
  }

  return playerStats;
}

function setWorldProperty(playerId, newData) {
  const dataStore = loadStore();
  dataStore[playerId] = newData;
  saveStore();
}

function normalizeTeamId(teamId) {
  return teamId && teamId !== "" ? teamId : null;
}

// อัปเดตข้อมูล player ลง world (แบบ partial update / patch)
export function updateWorldProperty(playerId, patchData) {
  const dataStore = loadStore();

  let playerStats = dataStore[playerId];
  if (!playerStats) {
    playerStats = Object.assign({}, DEFAULT_STATS);
    dataStore[playerId] = playerStats;
  }

  if (patchData.name !== undefined) {
    playerStats.name = patchData.name;
  }

  if (patchData.teamId !== undefined) {
    playerStats.teamId = normalizeTeamId(patchData.teamId);
  }

  if (patchData.playTime !== undefined) {
    playerStats.playTime = Number(patchData.playTime) || 0;
  }

  if (patchData.kills !== undefined) {
    playerStats.kills = Number(patchData.kills) || 0;
  }

  if (patchData.deaths !== undefined) {
    playerStats.deaths = Number(patchData.deaths) || 0;
  }

  if (patchData.isUhc !== undefined) {
    playerStats.isUhc = Boolean(patchData.isUhc);
  }

  if (patchData.isAlive !== undefined) {
    playerStats.isAlive = Boolean(patchData.isAlive);
  }

  saveStore();
}

function applyPlayerTeam(player, statsData) {
  if (!player?.isValid) return;
  const teamId = statsData.teamId;
  if (!teamId) return;
  RuntimeStore.set(player.id, "teamId", teamId);
  const tags = [...player.getTags()];
  for (const tag of tags) {
    if (tag.startsWith("team") && tag !== teamId) {
      player.removeTag(tag);
    }
  }

  if (teamId && !tags.includes(teamId)) {
    player.addTag(teamId);
  }
}

// =================================================
// Player Spawn
// =================================================
world.afterEvents.playerSpawn.subscribe((event) => {
  const player = event.player;
  if (!player?.isValid) return;

  const playerId = player.id;

  // Runtime Init
  RuntimeStore.set(playerId, RUNTIME_KEY.DEATH_LOCATION, 0);
  RuntimeStore.set(playerId, RUNTIME_KEY.HIT_COUNT, 0);
  RuntimeStore.set(playerId, RUNTIME_KEY.KILL_STREAK, 0);
  RuntimeStore.set(playerId, RUNTIME_KEY.LAST_DAMAGE, 0);
  RuntimeStore.set(playerId, RUNTIME_KEY.MULTI_KILL, 0);

  //Persistent Stats
  const statsData = getWorldProperty(playerId);
  statsData.name = player.name;
  updateWorldProperty(playerId, { name: statsData.name });
  applyPlayerTeam(player, statsData);

  // Cache Update
  addToCache(allPlayersCache, playerId, player.name);

  if (statsData.isUhc) {
    addToCache(uhcPlayersCache, playerId, player.name);
  }

  // Debug Logs
  console.warn("[SPAWN] name:", player.name);
  console.warn("[SPAWN] id:", playerId);
  console.warn("[SPAWN] allPlayersCache:", formatPlayerCache(allPlayersCache));
  console.warn("[SPAWN] uhcPlayersCache:", formatPlayerCache(uhcPlayersCache));
  console.warn("[SPAWN] runtime:", JSON.stringify(playerStore.get(playerId)));
  console.warn("[SPAWN] worldProperty:", JSON.stringify(statsData));
  console.warn("[SPAWN] tags:", player.getTags().join(", "));
});

// =================================================
// player Leave
// =================================================
world.afterEvents.playerLeave.subscribe(({ playerId }) => {
  if (!playerId) return;

  const id = playerId;

  // Get Stored Data
  const runtime = playerStore.get(id);
  const stats = getWorldProperty(id);

  // Debug Logs
  console.warn("[LEAVE] name:", stats.name);
  console.warn("[LEAVE] id:", id);
  console.warn("[LEAVE] runtime:", JSON.stringify(runtime));
  console.warn("[LEAVE] worldProperty:", JSON.stringify(stats));

  // Cleanup Runtime
  RuntimeStore.remove(id);

  // Cache Cleanup
  allPlayersCache = removeFromCache(allPlayersCache, id);
  uhcPlayersCache = removeFromCache(uhcPlayersCache, id);

  console.warn("[LEAVE] allPlayersCache:", formatPlayerCache(allPlayersCache));
  console.warn("[LEAVE] uhcPlayersCache:", formatPlayerCache(uhcPlayersCache));
});
