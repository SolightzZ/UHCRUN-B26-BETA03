import { world, system, EquipmentSlot, ItemComponentTypes, EnchantmentType } from "@minecraft/server";
import { dynamicToast } from "./Util";

const ENCHANT_LEVEL = 4;
const LORE_MARKER = "§7[UHCRUN]";
const SOUND = "block.enchanting_table.use";

let EFFICIENCY = null;
function getEfficiency() {
  return (EFFICIENCY ??= new EnchantmentType("minecraft:efficiency"));
}

const TOOLS = new Map([
  ["minecraft:wooden_pickaxe", { name: "Wooden Pickaxe", texture: "wood_pickaxe" }],
  ["minecraft:stone_pickaxe", { name: "Stone Pickaxe", texture: "stone_pickaxe" }],
  ["minecraft:iron_pickaxe", { name: "Iron Pickaxe", texture: "iron_pickaxe" }],
  ["minecraft:golden_pickaxe", { name: "Golden Pickaxe", texture: "gold_pickaxe" }],
  ["minecraft:diamond_pickaxe", { name: "Diamond Pickaxe", texture: "diamond_pickaxe" }],
  ["minecraft:wooden_shovel", { name: "Wooden Shovel", texture: "wood_shovel" }],
  ["minecraft:stone_shovel", { name: "Stone Shovel", texture: "stone_shovel" }],
  ["minecraft:iron_shovel", { name: "Iron Shovel", texture: "iron_shovel" }],
  ["minecraft:golden_shovel", { name: "Golden Shovel", texture: "gold_shovel" }],
  ["minecraft:diamond_shovel", { name: "Diamond Shovel", texture: "diamond_shovel" }],
]);

const ENCHANT_WINDOW_TICKS = 3;

const lastEnchantTick = new Map();

function buildEnchantedItem(item, lore) {
  const clone = item.clone();
  const enchantable = clone.getComponent(ItemComponentTypes.Enchantable);
  if (!enchantable) return null;

  try {
    enchantable.addEnchantment({ type: getEfficiency(), level: ENCHANT_LEVEL });
  } catch {
    return null;
  }

  clone.setLore(lore.concat(LORE_MARKER));
  return clone;
}

world.afterEvents.playerHotbarSelectedSlotChange.subscribe(({ player }) => {
  if (!player?.isValid) return;

  const currentTick = system.currentTick;
  const lastTick = lastEnchantTick.get(player.id) ?? -ENCHANT_WINDOW_TICKS;
  if (currentTick - lastTick < ENCHANT_WINDOW_TICKS) return;

  const equip = player.getComponent("minecraft:equippable");
  if (!equip) return;

  const item = equip.getEquipment(EquipmentSlot.Mainhand);
  if (!item) return;

  const tool = TOOLS.get(item.typeId);
  if (!tool) return;

  const loreArr = item.getLore();
  if (loreArr.indexOf(LORE_MARKER) !== -1) return;

  lastEnchantTick.set(player.id, currentTick);

  const newItem = buildEnchantedItem(item, loreArr);
  if (!newItem) return;

  equip.setEquipment(EquipmentSlot.Mainhand, newItem);
  player.sendMessage(dynamicToast(`§f${tool.name}\n§7Efficiency §bIV`, `textures/items/${tool.texture}`));
  player.playSound(SOUND);
});

world.afterEvents.playerLeave.subscribe(({ playerId }) => {
  lastEnchantTick.delete(playerId);
});
