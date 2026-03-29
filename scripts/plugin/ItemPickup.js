import { world, system, ItemStack } from "@minecraft/server";

const SMELT = Object.freeze({
  "minecraft:raw_iron": "minecraft:iron_ingot",
  "minecraft:raw_gold": "minecraft:gold_ingot",
});

const SMELT_TYPES = new Set(Object.keys(SMELT));

const PENDING_MAX = 32;
const pendingList = [];

let flushScheduled = false;

function getContainer(player) {
  return player.getComponent("minecraft:inventory")?.container ?? null;
}

function findEntry(playerId) {
  for (let i = 0; i < pendingList.length; i++) {
    if (pendingList[i].id === playerId) return pendingList[i];
  }
  return null;
}

function smeltSlots(player, slots) {
  if (!player?.isValid) return;
  const container = getContainer(player);
  if (!container) return;

  for (const slot of slots) {
    const item = container.getItem(slot);
    if (!item) continue;

    const result = SMELT[item.typeId];
    if (!result) continue;

    const amount = item.amount;
    container.setItem(slot, undefined);

    const leftover = container.addItem(new ItemStack(result, amount));
    if (leftover) player.dimension.spawnItem(leftover, player.location);

    player.addExperience(amount * 2);
  }
}

function scheduleFlushed() {
  if (flushScheduled) return;
  flushScheduled = true;

  system.run(() => {
    flushScheduled = false;
    const entries = pendingList.splice(0);
    for (const entry of entries) smeltSlots(entry.player, entry.slots);
  });
}

function onPickup(ev) {
  const player = ev.entity;
  if (!player?.isValid || player.typeId !== "minecraft:player") return;

  const pickedTypeId = ev.itemStack?.typeId;
  if (!pickedTypeId || !SMELT_TYPES.has(pickedTypeId)) return;

  const container = getContainer(player);
  if (!container) return;

  let entry = findEntry(player.id);

  if (!entry) {
    if (pendingList.length >= PENDING_MAX) {
      console.warn("[ItemPickup] queue full, dropping oldest entry");
      pendingList.shift();
    }

    entry = { id: player.id, player, slots: new Set() };
    pendingList.push(entry);
  }

  for (let i = 0; i < container.size; i++) {
    const item = container.getItem(i);
    if (item?.typeId === pickedTypeId) {
      entry.slots.add(i);
      break;
    }
  }

  scheduleFlushed();
}

world.afterEvents.entityItemPickup.subscribe(onPickup);
