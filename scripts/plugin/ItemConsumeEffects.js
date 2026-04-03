import { world } from "@minecraft/server";

// ======================================================
// COOKED ITEM LIST
// ======================================================
const items = [
  "minecraft:cooked_beef",
  "minecraft:cooked_porkchop",
  "minecraft:cooked_chicken",
  "minecraft:cooked_mutton",
  "minecraft:cooked_rabbit",
  "minecraft:cooked_cod",
  "minecraft:cooked_salmon",
];

// ======================================================
// isCookedFood
// ======================================================
function isCookedFood(itemId) {
  if (!itemId) return false;
  return items.includes(itemId);
}

// ======================================================
// applyCookedEffect (เลือดอย่างเดียว)
// ======================================================
function applyCookedEffect(player) {
  player.addEffect("regeneration", 200, {
    amplifier: 1,
    showParticles: false,
  });
}

// ======================================================
// handleConsume
// ======================================================
function handleConsume(player, item) {
  if (!player || !item) return;

  const itemId = item.typeId;

  if (!isCookedFood(itemId)) return;

  applyCookedEffect(player);
}

// ======================================================
// Event
// ======================================================
world.afterEvents.itemCompleteUse.subscribe((ev) => {
  const player = ev.source;
  if (!player?.isValid) return;

  const item = ev.itemStack;
  if (!item) return;

  handleConsume(player, item);
});
