import { world, system } from "@minecraft/server";

const KB_H = 1.25;
const KB_V = 0.38;
const HOOK_ID = "minecraft:fishing_hook";
const PLAYER_ID = "minecraft:player";
const CAST_SOUND = "minecraft:item.fishing_rod.cast";
const SOUND_OPTS = { volume: 0.7, pitch: 1 };

function isValidPvP(a, b) {
  return a?.isValid && b?.isValid && a.typeId === PLAYER_ID && b.typeId === PLAYER_ID && a.id !== b.id;
}

function applyKnockback(target, source) {
  if (!isValidPvP(target, source)) return;
  const dir = source.getViewDirection();
  const len = Math.hypot(dir.x, dir.z) || 1;

  target.applyKnockback({ x: (dir.x / len) * KB_H, z: (dir.z / len) * KB_H }, KB_V);
}

world.afterEvents.projectileHitEntity.subscribe((ev) => {
  const { projectile: proj, source } = ev;
  if (proj?.typeId !== HOOK_ID) return;
  if (!source?.isValid) return;

  const target = ev.getEntityHit()?.entity;
  if (!isValidPvP(target, source)) return;

  applyKnockback(target, source);

  source.playSound(CAST_SOUND, SOUND_OPTS);

  system.run(() => {
    if (proj?.isValid) proj.remove();
  });
});
