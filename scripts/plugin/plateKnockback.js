import { world } from "@minecraft/server";
import { KB, clamp } from "./Util";

const PLATE = Object.freeze({ horizontal: 0.35, vertical: 1.2 });
const PLATE_TYPES = new Set(["minecraft:crimson_pressure_plate"]);
const SOUNDS = ["mob.shulker.shoot", "firework.blast", "firework.large_blast", "firework.twinkle"];

let soundIdx = 0;
function nextSound() {
  const sound = SOUNDS[soundIdx];
  soundIdx = (soundIdx + 1) % SOUNDS.length;
  return sound;
}

world.afterEvents.pressurePlatePush.subscribe(({ block, source: player }) => {
  if (!PLATE_TYPES.has(block.typeId)) return;
  if (!player?.isValid) return;

  const dir = player.getViewDirection();
  const len = Math.hypot(dir.x, dir.z) || 1;
  const nx = dir.x / len;
  const nz = dir.z / len;

  player.applyKnockback({ x: clamp(nx * PLATE.horizontal, KB.maxHorizontal), z: clamp(nz * PLATE.horizontal, KB.maxHorizontal) }, PLATE.vertical);
  block.dimension.playSound(nextSound(), player.location);
});
