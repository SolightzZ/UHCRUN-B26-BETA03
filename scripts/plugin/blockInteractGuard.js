import { world, system } from "@minecraft/server";

const BLOCK_DENYLIST = new Set([
  "minecraft:cartography_table",
  "minecraft:brewing_stand",
  "minecraft:furnace",
  "minecraft:blast_furnace",
  "minecraft:grindstone",
  "minecraft:smithing_table",
  "minecraft:shulker_box",
  "minecraft:hopper",
  "minecraft:flower_pot",
  "minecraft:smoker",
  "minecraft:respawn_anchor",
  "minecraft:barrel",
  "minecraft:composter",
]);

const DOOR_KEYWORDS = ["gate", "trapdoor", "candle", "decorated_pot", "crafter"];
const DOOR_REGEX = new RegExp(DOOR_KEYWORDS.join("|"));

const DOOR_CACHE_MAX = 128;
const doorLikeCache = Object.create(null);
let doorCacheSize = 0;

function isDoorLike(typeId) {
  const cached = doorLikeCache[typeId];
  if (cached !== undefined) return cached;

  const result = DOOR_REGEX.test(typeId);

  if (doorCacheSize >= DOOR_CACHE_MAX) {
    for (const key in doorLikeCache) {
      delete doorLikeCache[key];
      doorCacheSize--;
      break;
    }
  }

  doorLikeCache[typeId] = result;
  doorCacheSize++;
  return result;
}

const SHULKER_SOUNDS = ["mob.shulker.shoot", "firework.blast", "firework.large_blast", "firework.twinkle"];

let shulkerSoundIdx = 0;
function nextShulkerSound() {
  const sound = SHULKER_SOUNDS[shulkerSoundIdx];
  shulkerSoundIdx = (shulkerSoundIdx + 1) % SHULKER_SOUNDS.length;
  return sound;
}

function handleEnderChest(event, player) {
  event.cancel = true;

  const dir = player.getViewDirection();
  const kbX = -dir.x * 2;
  const kbZ = -dir.z * 2;

  system.run(() => {
    if (!player?.isValid) return;
    player.applyKnockback({ x: kbX, z: kbZ }, 0.5);
    player.playSound(nextShulkerSound(), player.location);
  });
}

world.beforeEvents.playerInteractWithBlock.subscribe((event) => {
  const { block, player } = event;
  if (!block?.isValid || !player) return;

  const { typeId } = block;

  if (typeId === "minecraft:ender_chest") return handleEnderChest(event, player);
  if (BLOCK_DENYLIST.has(typeId)) return (event.cancel = true);

  if (!player.hasTag("uhc") && isDoorLike(typeId)) {
    event.cancel = true;
  }
});

world.afterEvents.entitySpawn.subscribe(({ entity }) => {
  if (!entity?.isValid || entity.typeId !== "minecraft:item") return;

  const stack = entity.getComponent("minecraft:item")?.itemStack;
  if (stack?.typeId !== "minecraft:hopper_minecart") return;

  entity.dimension.spawnParticle("minecraft:explode_particle", entity.location);
  entity.remove();
});
