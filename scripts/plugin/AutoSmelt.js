import { world, ItemStack, system } from "@minecraft/server";
import { dynamicToast } from "../plugin/Util";

const CONFIG = Object.freeze({
  scan: Object.freeze({ itemRadius: 2 }),
  xp: Object.freeze({
    smelt: [1, 4],
    coal: [1, 10],
    copper: [1, 8],
    emerald: [1, 15],
    redstone: [1, 4],
  }),
  chance: Object.freeze({ absorption: 16, lapisBook: 12 }),
  redstone: Object.freeze({
    healAmount: 2,
    absorptionDuration: 12000,
    absorptionMinutes: 10,
  }),
  sounds: Object.freeze({ orb: "random.orb", level: "random.levelup" }),
  feedback: Object.freeze({
    arrow: Object.freeze({ message: "Arrow §a+1", texture: "textures/items/arrow" }),
    book: Object.freeze({ message: "Book §a+1", texture: "textures/items/book_normal" }),
    health: Object.freeze({ texture: "textures/ui/heart_new" }),
    absorption: Object.freeze({ texture: "textures/ui/absorption_heart" }),
  }),
});

const ACTION = Object.freeze({
  SMELT: 1,
  SMELT_XP: 2,
  LAPIS: 3,
  GRAVEL: 4,
  REDSTONE: 5,
  EFFECT: 6,
});

const BLOCK_ACTION_MAP = new Map([
  ["minecraft:iron_ore", ACTION.SMELT],
  ["minecraft:deepslate_iron_ore", ACTION.SMELT],
  ["minecraft:gold_ore", ACTION.SMELT],
  ["minecraft:deepslate_gold_ore", ACTION.SMELT],
  ["minecraft:coal_ore", ACTION.SMELT_XP],
  ["minecraft:copper_ore", ACTION.SMELT_XP],
  ["minecraft:deepslate_copper_ore", ACTION.SMELT_XP],
  ["minecraft:emerald_ore", ACTION.SMELT_XP],
  ["minecraft:deepslate_emerald_ore", ACTION.SMELT_XP],
  ["minecraft:lapis_ore", ACTION.LAPIS],
  ["minecraft:deepslate_lapis_ore", ACTION.LAPIS],
  ["minecraft:gravel", ACTION.GRAVEL],
  ["minecraft:redstone_ore", ACTION.REDSTONE],
  ["minecraft:lit_redstone_ore", ACTION.REDSTONE],
  ["minecraft:deepslate_redstone_ore", ACTION.REDSTONE],
  ["minecraft:lit_deepslate_redstone_ore", ACTION.REDSTONE],
  ["minecraft:diamond_ore", ACTION.EFFECT],
  ["minecraft:deepslate_diamond_ore", ACTION.EFFECT],
  ["minecraft:obsidian", ACTION.EFFECT],
]);

const PICKAXES = new Set([
  "minecraft:wooden_pickaxe",
  "minecraft:stone_pickaxe",
  "minecraft:golden_pickaxe",
  "minecraft:iron_pickaxe",
  "minecraft:diamond_pickaxe",
  "minecraft:netherite_pickaxe",
]);

const SHOVELS = new Set([
  "minecraft:wooden_shovel",
  "minecraft:stone_shovel",
  "minecraft:iron_shovel",
  "minecraft:golden_shovel",
  "minecraft:diamond_shovel",
  "minecraft:netherite_shovel",
]);

const SOUND_OPTIONS = Object.freeze({
  effect: Object.freeze({ volume: 0.2, pitch: 1.5 }),
  orb: Object.freeze({ volume: 0.4, pitch: 1.5 }),
  level: Object.freeze({ volume: 0.8, pitch: 1.5 }),
});

const toolCache = new Map();

world.afterEvents.playerLeave.subscribe((ev) => {
  toolCache.delete(ev.playerId);
});

function getCachedTool(player) {
  const playerId = player.id;
  if (!playerId) return null;

  const currentTick = system.currentTick;
  const cached = toolCache.get(playerId);
  if (cached && cached.tick === currentTick) return cached.tool;

  let tool = null;

  const inv = player.getComponent("minecraft:inventory")?.container;
  tool = inv ? (inv.getItem(player.selectedSlotIndex)?.typeId ?? null) : null;

  toolCache.set(playerId, { tool, tick: currentTick });
  return tool;
}

const randomInt = (min, max) => (Math.random() * (max - min + 1) + min) | 0;
const formatHealth = (v) => v.toFixed(1);

function isValidEntity(entity) {
  try {
    return !!entity && entity.isValid;
  } catch {
    return false;
  }
}

function isValidTool(tool, action) {
  if (action === ACTION.GRAVEL) return SHOVELS.has(tool);
  if (action === ACTION.EFFECT) return true;
  return PICKAXES.has(tool);
}

function addXp(player, amount) {
  if (amount > 0 && isValidEntity(player)) player.addExperience(amount);
}

const ITEM_TABLE = Object.freeze({
  "minecraft:flint": Object.freeze({ type: "special", handler: "flint" }),
  "minecraft:lapis_lazuli": Object.freeze({ type: "special", handler: "lapis" }),
  "minecraft:coal": Object.freeze({ type: "xp", range: CONFIG.xp.coal }),
  "minecraft:raw_copper": Object.freeze({ type: "xp", range: CONFIG.xp.copper }),
  "minecraft:emerald": Object.freeze({ type: "xp", range: CONFIG.xp.emerald }),
  "minecraft:raw_iron": Object.freeze({ type: "smelt", result: "minecraft:iron_ingot", xp: CONFIG.xp.smelt }),
  "minecraft:raw_gold": Object.freeze({ type: "smelt", result: "minecraft:gold_ingot", xp: CONFIG.xp.smelt }),
  "minecraft:redstone": Object.freeze({ type: "redstone" }),
});

function spawnStacked(dimension, typeId, amount, pos, loreFn) {
  let remaining = Math.max(1, amount);
  while (remaining > 0) {
    const count = Math.min(remaining, 64);
    const stack = new ItemStack(typeId, count);
    if (loreFn) loreFn(stack);
    dimension.spawnItem(stack, pos);
    remaining -= count;
  }
}

function safeStack(typeId, amount) {
  return new ItemStack(typeId, Math.max(1, Math.min(amount, 64)));
}

function spawnLoc(loc) {
  return { x: Math.floor(loc.x) + 0.5, y: loc.y + 0.5, z: Math.floor(loc.z) + 0.5 };
}

function processItem(entity, action, player, dimension) {
  if (!isValidEntity(entity)) return { xp: 0, lapis: null };

  const stack = entity.getComponent("minecraft:item")?.itemStack;
  if (!stack) return { xp: 0, lapis: null };

  const itemData = ITEM_TABLE[stack.typeId];
  if (!itemData) return { xp: 0, lapis: null };

  const spawnAt = entity.location;

  switch (itemData.type) {
    case "special":
      switch (itemData.handler) {
        case "flint":
          spawnStacked(dimension, "minecraft:arrow", stack.amount, spawnAt);
          entity.remove();
          player.sendMessage(dynamicToast(CONFIG.feedback.arrow.message, CONFIG.feedback.arrow.texture));
          return { xp: 0, lapis: null };

        case "lapis":
          if (action === ACTION.LAPIS) {
            const lore = stack.getLore?.();
            if (!lore?.length) {
              const lapis = { total: stack.amount, position: spawnAt };
              entity.remove();
              return { xp: 0, lapis };
            }
          }
          return { xp: 0, lapis: null };

        default:
          return { xp: 0, lapis: null };
      }

    case "xp": {
      const xp = randomInt(itemData.range[0], itemData.range[1]) * stack.amount;
      entity.remove();
      return { xp, lapis: null };
    }

    case "smelt": {
      spawnStacked(dimension, itemData.result, stack.amount, spawnAt);
      const xp = randomInt(itemData.xp[0], itemData.xp[1]) * stack.amount;
      entity.remove();
      return { xp, lapis: null };
    }

    case "redstone":
      if (action === ACTION.REDSTONE) entity.remove();
      return { xp: 0, lapis: null };

    default:
      return { xp: 0, lapis: null };
  }
}

function spawnLapisRewards(player, dimension, lapisData) {
  if (!lapisData.total) return;

  const pos = lapisData.position;

  if (randomInt(0, 99) < CONFIG.chance.lapisBook) {
    dimension.spawnItem(safeStack("minecraft:book", 1), pos);
    if (system.currentTick % 2 === 0) {
      player.sendMessage(dynamicToast(CONFIG.feedback.book.message, CONFIG.feedback.book.texture));
    }
  }

  spawnStacked(dimension, "minecraft:lapis_lazuli", 1, pos, (s) => s.setLore(["§7uhc"]));
}

const pendingJobs = new Map();
const scheduledDims = new Set();

function scheduleBatch(player, location, action, dimension) {
  const dimId = dimension.id;
  if (!pendingJobs.has(dimId)) pendingJobs.set(dimId, []);
  pendingJobs.get(dimId).push({ player, location, action, dimension });

  if (scheduledDims.has(dimId)) return;
  scheduledDims.add(dimId);

  system.runTimeout(() => {
    scheduledDims.delete(dimId);
    const jobs = pendingJobs.get(dimId);
    pendingJobs.delete(dimId);
    if (jobs) flushBatch(jobs);
  }, 2);
}

const _r2 = CONFIG.scan.itemRadius ** 2;

function flushBatch(jobs) {
  if (!jobs.length) return;

  const claimed = new Set();
  const center = { x: 0, y: 0, z: 0 };

  const { dimension } = jobs[0];

  if (jobs.length === 1) {
    const job = jobs[0];
    if (!isValidEntity(job.player)) return;
    center.x = job.location.x;
    center.y = job.location.y;
    center.z = job.location.z;
    let entities;
    try {
      entities = dimension.getEntities({ type: "minecraft:item", location: center, maxDistance: CONFIG.scan.itemRadius });
    } catch {
      return;
    }
    if (!entities.length) return;
    claimed.clear();
    let totalXp = 0,
      lapisTotal = 0,
      lapisPosition = job.location;
    for (const entity of entities) {
      if (!isValidEntity(entity)) continue;
      claimed.add(entity.id);
      const result = processItem(entity, job.action, job.player, dimension);
      totalXp += result.xp;
      if (result.lapis) {
        lapisTotal += result.lapis.total;
        lapisPosition = result.lapis.position;
      }
    }
    spawnLapisRewards(job.player, dimension, { total: lapisTotal, position: lapisPosition });
    addXp(job.player, totalXp);
    return;
  }

  let minX = Infinity,
    minY = Infinity,
    minZ = Infinity;
  let maxX = -Infinity,
    maxY = -Infinity,
    maxZ = -Infinity;
  for (const job of jobs) {
    const { x, y, z } = job.location;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
  }

  center.x = (minX + maxX) / 2;
  center.y = (minY + maxY) / 2;
  center.z = (minZ + maxZ) / 2;
  const hx = (maxX - minX) / 2,
    hy = (maxY - minY) / 2,
    hz = (maxZ - minZ) / 2;
  const halfDiag = Math.sqrt(hx * hx + hy * hy + hz * hz) + CONFIG.scan.itemRadius;

  let allEntities;
  try {
    allEntities = dimension.getEntities({ type: "minecraft:item", location: center, maxDistance: halfDiag });
  } catch {
    return;
  }

  if (!allEntities.length) return;

  claimed.clear();

  for (const job of jobs) {
    if (!isValidEntity(job.player)) continue;

    let totalXp = 0;
    let lapisTotal = 0;
    let lapisPosition = job.location;

    for (const entity of allEntities) {
      if (claimed.has(entity.id)) continue;
      if (!isValidEntity(entity)) continue;

      const el = entity.location;
      const dx = el.x - job.location.x,
        dy = el.y - job.location.y,
        dz = el.z - job.location.z;
      if (dx * dx + dy * dy + dz * dz > _r2) continue;

      claimed.add(entity.id);
      const result = processItem(entity, job.action, job.player, dimension);
      totalXp += result.xp;
      if (result.lapis) {
        lapisTotal += result.lapis.total;
        lapisPosition = result.lapis.position;
      }
    }

    spawnLapisRewards(job.player, dimension, { total: lapisTotal, position: lapisPosition });
    addXp(job.player, totalXp);
  }
}

function healPlayer(player) {
  if (!isValidEntity(player)) return;

  const health = player.getComponent("minecraft:health");
  if (!health) return;

  const current = health.currentValue;
  const max = health.effectiveMax;
  if (current >= max) return;

  const newHealth = Math.min(max, current + CONFIG.redstone.healAmount);
  health.setCurrentValue(newHealth);
  player.sendMessage(dynamicToast(`§a+${formatHealth(newHealth - current)} §7(${formatHealth(newHealth)})`, CONFIG.feedback.health.texture));
}

function tryAbsorption(player) {
  if (!isValidEntity(player)) return false;
  if (randomInt(0, 99) >= CONFIG.chance.absorption) return false;

  player.addEffect("absorption", CONFIG.redstone.absorptionDuration, {
    amplifier: 0,
    showParticles: false,
  });
  player.sendMessage(dynamicToast(`§fAbsorption §7(${CONFIG.redstone.absorptionMinutes}m)`, CONFIG.feedback.absorption.texture));
  player.playSound(CONFIG.sounds.level, SOUND_OPTIONS.level);
  return true;
}

function handleRedstone(player) {
  addXp(player, randomInt(CONFIG.xp.redstone[0], CONFIG.xp.redstone[1]));
  healPlayer(player);
  if (!tryAbsorption(player)) player.playSound(CONFIG.sounds.orb, SOUND_OPTIONS.orb);
}

function executeAction(player, location, action, dimension) {
  player.playSound(CONFIG.sounds.orb, SOUND_OPTIONS.effect);

  if (action === ACTION.REDSTONE) {
    handleRedstone(player);
  }

  if (action === ACTION.EFFECT) return;

  scheduleBatch(player, spawnLoc(location), action, dimension);
}

world.afterEvents.playerBreakBlock.subscribe((ev) => {
  const player = ev.player;
  if (!isValidEntity(player)) return;

  const action = BLOCK_ACTION_MAP.get(ev.brokenBlockPermutation.type.id);
  if (!action) return;

  const tool = getCachedTool(player);
  if (!tool || !isValidTool(tool, action)) return;

  executeAction(player, ev.block.location, action, ev.block.dimension);
});
