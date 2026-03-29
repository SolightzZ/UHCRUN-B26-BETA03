import { world, system, ItemStack, EntityInventoryComponent, ItemComponentTypes, BlockPermutation } from "@minecraft/server";

const CONFIG = Object.freeze({
  MAX_LOGS: 16,
  MAX_LEAVES: 64,
  CANOPY_RADIUS: 3,
  LEAF_SCAN_PAD: 4,
  APPLE_CHANCE: 0.02,
  COOLDOWN_TICKS: 5,
  SCAN_BLOCK_CAP: 400,
  BREAK_PER_TICK: 6,
  LEAF_BREAK_PER_TICK: 18,
  MAX_CONCURRENT_JOBS: 4,
  MAX_QUEUE_SIZE: 50,
  MAX_JOBS_PER_PLAYER: 3,
  MAX_APPLES: 3,
});

const WOOD_MAP = Object.freeze({
  "minecraft:oak_log": "minecraft:oak_leaves",
  "minecraft:birch_log": "minecraft:birch_leaves",
  "minecraft:spruce_log": "minecraft:spruce_leaves",
  "minecraft:jungle_log": "minecraft:jungle_leaves",
  "minecraft:acacia_log": "minecraft:acacia_leaves",
  "minecraft:dark_oak_log": "minecraft:dark_oak_leaves",
  "minecraft:mangrove_log": "minecraft:mangrove_leaves",
  "minecraft:cherry_log": "minecraft:cherry_leaves",
  "minecraft:pale_oak_log": "minecraft:pale_oak_leaves",
});

const LOG_SET = new Set(Object.keys(WOOD_MAP));
const AXE_SET = new Set([
  "minecraft:wooden_axe",
  "minecraft:stone_axe",
  "minecraft:iron_axe",
  "minecraft:golden_axe",
  "minecraft:diamond_axe",
  "minecraft:netherite_axe",
]);

const NEIGHBOUR_OFFSETS = Object.freeze([1, 0, 0, -1, 0, 0, 0, 1, 0, 0, -1, 0, 0, 0, 1, 0, 0, -1]);

const LEAF_SCAN_BATCH_SIZE = 50;
const ITEM_BATCH_THRESHOLD = 8;

const lastFellTick = new Map();
const playerJobCount = new Map();
const lastEnqueueTick = new Map();
const jobQueue = [];
let activeJobs = 0;

function hashLoc(x, y, z) {
  let h = (x * 374761393) ^ (y * 668265263) ^ (z * 2246822519);
  h ^= h >>> 13;
  h = Math.imul(h, 1540483477);
  h ^= h >>> 15;
  return h;
}

let AIR = null;

function getAir() {
  if (!AIR) AIR = BlockPermutation.resolve("minecraft:air");
  return AIR;
}

system.run(() => {
  AIR = BlockPermutation.resolve("minecraft:air");
});

function getHeldItem(player) {
  const inv = player.getComponent(EntityInventoryComponent.componentId);
  return inv?.container?.getItem(player.selectedSlotIndex);
}

function applyToolDamage(player, amount, axeTypeId) {
  if (!player?.isValid) return false;
  const inv = player.getComponent(EntityInventoryComponent.componentId);
  const container = inv?.container;
  if (!container) return false;
  const slot = player.selectedSlotIndex;
  const item = container.getItem(slot);
  if (!item || item.typeId !== axeTypeId) return false;

  if (player.selectedSlotIndex !== slot) return false;
  const dur = item.getComponent(ItemComponentTypes.Durability);
  if (!dur) return true;
  const prev = dur.damage;
  dur.damage = Math.min(dur.damage + amount, dur.maxDurability);
  if (dur.damage >= dur.maxDurability) {
    container.setItem(slot, undefined);
    player.playSound("random.break", { location: player.location, volume: 1.0, pitch: 0.9 });
    return false;
  }
  if (dur.damage !== prev) container.setItem(slot, item);
  return true;
}

function isDimensionValid(dim) {
  try {
    return dim?.id !== undefined;
  } catch {
    return false;
  }
}

function checkCooldown(playerId) {
  const now = system.currentTick;
  const last = lastFellTick.get(playerId) ?? -CONFIG.COOLDOWN_TICKS;
  if (now - last < CONFIG.COOLDOWN_TICKS) return false;
  lastFellTick.set(playerId, now);
  return true;
}

function adjustPlayerJobCount(playerId, delta) {
  const next = (playerJobCount.get(playerId) ?? 0) + delta;
  if (next <= 0) playerJobCount.delete(playerId);
  else playerJobCount.set(playerId, next);
}

function scanTrunk(dim, x, startY, z, logType, direction, out) {
  if (!isDimensionValid(dim)) return;
  out.length = 0;
  const loc = { x, y: startY, z };
  for (let count = 0; count < CONFIG.MAX_LOGS; count++) {
    const block = dim.getBlock(loc);
    if (!block?.isValid || block.typeId !== logType) break;
    out.push(loc.x, loc.y, loc.z);
    loc.y += direction;
  }
}

function* scanLeaves(dim, player, allLogs, anchorX, brokenY, anchorZ, leafType) {
  if (!isDimensionValid(dim)) return [];
  const { CANOPY_RADIUS: r, LEAF_SCAN_PAD: pad, MAX_LEAVES, SCAN_BLOCK_CAP } = CONFIG;

  let minY = brokenY,
    maxY = brokenY;
  for (let i = 1; i < allLogs.length; i += 3) {
    const y = allLogs[i];
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  const scanMinY = minY - 1;
  const scanMaxY = maxY + pad;

  const leaves = [];
  const visited = new Set();
  const queue = [];

  for (let i = 0; i < allLogs.length; i += 3) {
    const lx = allLogs[i],
      ly = allLogs[i + 1],
      lz = allLogs[i + 2];
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        if (dx === 0 && dz === 0) continue;
        const key = hashLoc(lx + dx, ly, lz + dz);
        if (!visited.has(key)) {
          visited.add(key);
          queue.push(lx + dx, ly, lz + dz);
        }
      }
    }
  }

  const QUEUE_CAP = SCAN_BLOCK_CAP * 3;
  let calls = 0;
  let batchCalls = 0;
  const loc = { x: 0, y: 0, z: 0 };
  let qi = 0;

  while (qi < queue.length && leaves.length / 3 < MAX_LEAVES && calls < SCAN_BLOCK_CAP) {
    if (!player?.isValid) return [];

    if (queue.length - qi > QUEUE_CAP) {
      yield { type: "progress", leaves };
      continue;
    }

    const cx = queue[qi++],
      cy = queue[qi++],
      cz = queue[qi++];

    if (cy < scanMinY || cy > scanMaxY) continue;
    if (Math.abs(cx - anchorX) > r || Math.abs(cz - anchorZ) > r) continue;

    loc.x = cx;
    loc.y = cy;
    loc.z = cz;
    let block;
    try {
      block = dim.getBlock(loc);
    } catch {
      continue;
    }
    calls++;
    batchCalls++;

    if (!block?.isValid || block.typeId !== leafType) continue;
    leaves.push(cx, cy, cz);

    for (let ni = 0; ni < NEIGHBOUR_OFFSETS.length; ni += 3) {
      const nx = cx + NEIGHBOUR_OFFSETS[ni],
        ny = cy + NEIGHBOUR_OFFSETS[ni + 1],
        nz = cz + NEIGHBOUR_OFFSETS[ni + 2];
      const nkey = hashLoc(nx, ny, nz);
      if (!visited.has(nkey)) {
        visited.add(nkey);
        if (queue.length - qi < QUEUE_CAP) queue.push(nx, ny, nz);
      }
    }

    if (batchCalls >= LEAF_SCAN_BATCH_SIZE) {
      batchCalls = 0;
      yield { type: "progress", leaves };
    }
  }

  return leaves;
}

function* breakLogBlocks(dim, logs, logType) {
  if (!isDimensionValid(dim)) return 0;
  let broken = 0,
    batch = 0,
    itemBatch = [];
  const loc = { x: 0, y: 0, z: 0 };
  const air = getAir();
  if (!air) return 0;
  for (let i = 0; i < logs.length; i += 3) {
    loc.x = logs[i];
    loc.y = logs[i + 1];
    loc.z = logs[i + 2];
    try {
      const block = dim.getBlock(loc);
      if (block?.isValid && block.typeId === logType) {
        block.setPermutation(air);
        itemBatch.push({ x: loc.x, y: loc.y, z: loc.z });
        if (itemBatch.length >= ITEM_BATCH_THRESHOLD) {
          const stack = new ItemStack(logType, itemBatch.length);
          const center = itemBatch[Math.floor(itemBatch.length / 2)];
          dim.spawnItem(stack, center);
          itemBatch.length = 0;
        }
        broken++;
      }
    } catch {}
    if (++batch >= CONFIG.BREAK_PER_TICK) {
      batch = 0;
      yield;
    }
  }
  if (itemBatch.length > 0) {
    const stack = new ItemStack(logType, itemBatch.length);
    const center = itemBatch[Math.floor(itemBatch.length / 2)];
    dim.spawnItem(stack, center);
  }
  return broken;
}

function* breakLeafBlocks(dim, player, leaves, leafType) {
  if (!isDimensionValid(dim)) return 0;
  let broken = 0,
    batch = 0,
    appleBatch = 0;
  const loc = { x: 0, y: 0, z: 0 };
  const air = getAir();
  if (!air) return 0;

  for (let i = 0; i < leaves.length; i += 3) {
    if (!player?.isValid) break;
    loc.x = leaves[i];
    loc.y = leaves[i + 1];
    loc.z = leaves[i + 2];
    try {
      const block = dim.getBlock(loc);
      if (block?.isValid && block.typeId === leafType) {
        block.setPermutation(air);
        broken++;
        if (Math.random() < CONFIG.APPLE_CHANCE && appleBatch < CONFIG.MAX_APPLES) {
          appleBatch++;
        }
      }
    } catch {}
    if (++batch >= CONFIG.LEAF_BREAK_PER_TICK) {
      batch = 0;
      yield;
    }
  }

  if (appleBatch > 0 && player?.isValid) {
    const appleStack = new ItemStack("minecraft:apple", appleBatch);
    dim.spawnItem(appleStack, { x: loc.x, y: loc.y, z: loc.z });

    player.playSound("random.orb", { location: player.location, volume: 0.8, pitch: 1.2 });
  }

  return broken;
}

function* breakTreeJob(player, dim, x, brokenY, z, logType, leafType, axeTypeId) {
  if (!player?.isValid || !isDimensionValid(dim)) return;

  const logsBelow = [],
    logsAbove = [],
    allLogs = [];
  try {
    scanTrunk(dim, x, brokenY - 1, z, logType, -1, logsBelow);
    scanTrunk(dim, x, brokenY + 1, z, logType, 1, logsAbove);
  } catch {
    return;
  }

  for (let i = 0; i < logsAbove.length; i++) allLogs.push(logsAbove[i]);
  for (let i = 0; i < logsBelow.length; i++) allLogs.push(logsBelow[i]);
  yield;

  if (!player?.isValid || !isDimensionValid(dim)) return;

  let leaves = [];
  try {
    const leafGen = scanLeaves(dim, player, allLogs, x, brokenY, z, leafType);
    let result = leafGen.next();
    while (!result.done) {
      if (result.value?.type === "progress") {
        leaves = result.value.leaves;
      }
      if (!player?.isValid) return;
      yield;
      result = leafGen.next();
    }
    leaves = result.value || [];
  } catch {
    return;
  }

  if (!leaves.length || !player?.isValid) return;

  const brokenLogs = yield* breakLogBlocks(dim, allLogs, logType);
  yield* breakLeafBlocks(dim, player, leaves, leafType);

  if (!player?.isValid) return;

  const dmg = brokenLogs;
  if (dmg > 0 && player?.isValid) applyToolDamage(player, dmg, axeTypeId);
}

let schedulerPending = false;
let lastScheduledPlayerId = null;

function findFairJob() {
  if (jobQueue.length === 0) return null;

  if (jobQueue.length === 1 || !lastScheduledPlayerId) {
    return jobQueue.shift();
  }

  for (let i = 0; i < jobQueue.length; i++) {
    if (jobQueue[i].player.id !== lastScheduledPlayerId) {
      return jobQueue.splice(i, 1)[0];
    }
  }

  return jobQueue.shift();
}

function scheduleJobs() {
  schedulerPending = false;
  while (activeJobs < CONFIG.MAX_CONCURRENT_JOBS && jobQueue.length > 0) {
    const job = findFairJob();
    if (!job) break;

    activeJobs++;
    lastScheduledPlayerId = job.player.id;
    system.runJob(
      (function* (j) {
        const playerId = j.player.id;
        try {
          yield* breakTreeJob(j.player, j.dim, j.x, j.brokenY, j.z, j.logType, j.leafType, j.axeTypeId);
        } finally {
          activeJobs--;
          adjustPlayerJobCount(playerId, -1);
          if (jobQueue.length > 0 && !schedulerPending) {
            schedulerPending = true;
            system.run(scheduleJobs);
          }
        }
      })(job),
    );
  }
}

function enqueueTreeJob(player, dim, x, brokenY, z, logType, leafType, axeTypeId) {
  if (jobQueue.length >= CONFIG.MAX_QUEUE_SIZE) return false;
  const pjc = playerJobCount.get(player.id) ?? 0;
  if (pjc >= CONFIG.MAX_JOBS_PER_PLAYER) return false;

  const now = system.currentTick;
  const lastEnqueue = lastEnqueueTick.get(player.id) ?? -CONFIG.COOLDOWN_TICKS;
  if (now - lastEnqueue < CONFIG.COOLDOWN_TICKS) return false;
  lastEnqueueTick.set(player.id, now);

  jobQueue.push({ player, dim, x, brokenY, z, logType, leafType, axeTypeId });
  adjustPlayerJobCount(player.id, 1);
  scheduleJobs();
  return true;
}

function onPlayerBreakBlock(ev) {
  const player = ev?.player;
  if (!player?.isValid) return;
  const item = getHeldItem(player);
  if (!item || !AXE_SET.has(item.typeId)) return;
  const logType = ev.brokenBlockPermutation?.type?.id;
  if (!logType || !LOG_SET.has(logType)) return;
  if (!checkCooldown(player.id)) return;
  if (!ev.block?.isValid) return;

  const leafType = WOOD_MAP[logType];
  const dim = ev.block.dimension;
  const { x, y: brokenY, z } = ev.block.location;

  enqueueTreeJob(player, dim, x, brokenY, z, logType, leafType, item.typeId);
}

world.afterEvents.playerBreakBlock.subscribe(onPlayerBreakBlock);

world.afterEvents.playerLeave.subscribe(({ playerId }) => {
  lastFellTick.delete(playerId);
  playerJobCount.delete(playerId);
  lastEnqueueTick.delete(playerId);
});
