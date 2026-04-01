import { system, world } from "@minecraft/server";
import { formatPlayerCache, addToCache, removeFromCache } from "./DataHelpers";

const TEAMS = Object.freeze([
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
let allPlayersCacheIds = [];
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
    return dataKey in (playerStore.get(playerId) ?? {});
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
  teamId: "",
  playTime: 0,
  kills: 0,
  deaths: 0,
  isUhc: false,
  isAlive: false,
};

let worldPropertyStore = null;

function loadStore() {
  if (!worldPropertyStore) {
    const raw = world.getDynamicProperty("UhcPlayerworldProperty");
    worldPropertyStore = raw ? JSON.parse(raw) : {};
  }
  return worldPropertyStore;
}

function saveStore() {
  if (worldPropertyStore) {
    world.setDynamicProperty("UhcPlayerworldProperty", JSON.stringify(worldPropertyStore));
  }
}

function getWorldProperty(playerId) {
  const dataStore = loadStore();
  if (!dataStore[playerId]) {
    dataStore[playerId] = { ...DEFAULT_STATS };
  }

  return dataStore[playerId];
}

function setWorldProperty(playerId, newData) {
  const dataStore = loadStore();
  dataStore[playerId] = newData;
  saveStore();
}

function updateWorldProperty(playerId, patchData) {
  const dataStore = loadStore();
  let playerStats = dataStore[playerId];
  if (!playerStats) {
    playerStats = { ...DEFAULT_STATS };
    dataStore[playerId] = playerStats;
  }
  for (const key in patchData) {
    playerStats[key] = patchData[key];
  }
  saveStore();
}

world.afterEvents.playerSpawn.subscribe((event) => {
  const player = event.player;
  if (!player) return;

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
  updateWorldProperty(playerId, statsData);

  // Cache Update
  addToCache(allPlayersCache, playerId, player.name);

  if (player.hasTag("uhc")) {
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
