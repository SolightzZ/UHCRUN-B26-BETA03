import { world, system } from "@minecraft/server";
import { KB, clamp } from "./Util";

const PLAYER = "minecraft:player";

const KB_WINDOW_TICKS = 2;

const kbThrottle = new Map();

world.afterEvents.entityHurt.subscribe(({ hurtEntity: victim, damageSource }) => {
  const attacker = damageSource?.damagingEntity;

  if (!victim?.isValid || !attacker?.isValid) return;
  if (victim.typeId !== PLAYER || attacker.typeId !== PLAYER) return;

  const now = system.currentTick;
  const last = kbThrottle.get(victim.id) ?? -KB_WINDOW_TICKS;
  if (now - last < KB_WINDOW_TICKS) return;
  kbThrottle.set(victim.id, now);

  const vLoc = victim.location;
  const aLoc = attacker.location;
  if (!vLoc || !aLoc) return;

  const dx = vLoc.x - aLoc.x;
  const dz = vLoc.z - aLoc.z;
  const len = Math.hypot(dx, dz) || 1;
  const nx = dx / len;
  const nz = dz / len;

  const max = KB.maxHorizontal;
  const hx = clamp(nx * KB.horizontal, max);
  const hz = clamp(nz * KB.horizontal, max);

  victim.applyKnockback({ x: hx, z: hz }, KB.vertical);
});

world.afterEvents.playerLeave.subscribe(({ playerId }) => {
  kbThrottle.delete(playerId);
});
