import { world } from "@minecraft/server";

const PROJECTILES = new Set([
  "minecraft:arrow",
  "minecraft:thrown_trident",
  "minecraft:snowball",
  "minecraft:egg",
  "minecraft:blue_egg",
  "minecraft:brown_egg",
]);

world.afterEvents.projectileHitEntity.subscribe((ev) => {
  if (!PROJECTILES.has(ev.projectile?.typeId)) return;

  const shooter = ev.source?.isValid ? ev.source : (ev.projectile.getComponent("minecraft:projectile")?.owner ?? null);

  if (shooter?.typeId !== "minecraft:player") return;

  shooter.playSound("random.orb", { volume: 0.7, pitch: 0.5 });
});
