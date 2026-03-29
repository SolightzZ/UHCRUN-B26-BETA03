import { world, system } from "@minecraft/server";

const TNT = "minecraft:tnt";
const TNT_SPAWN_OFFSET = { x: 0.5, y: 0.4, z: 0.5 };
const TNT_COOLDOWN_TICKS = 2;
const TNT_GLOBAL_PER_TICK = 8;

const cdMap = new Map();

let tntGlobalTick = -1;
let tntGlobalCount = 0;

world.afterEvents.playerPlaceBlock.subscribe(
  ({ block, player }) => {
    if (!player?.isValid) return;

    const now = system.currentTick;
    const last = cdMap.get(player.id) ?? -TNT_COOLDOWN_TICKS;
    if (now - last < TNT_COOLDOWN_TICKS) return;
    cdMap.set(player.id, now);

    if (tntGlobalTick !== now) {
      tntGlobalTick = now;
      tntGlobalCount = 0;
    }
    if (tntGlobalCount >= TNT_GLOBAL_PER_TICK) return;
    tntGlobalCount++;

    const { x, y, z } = block.location;
    try {
      const entity = block.dimension.spawnEntity(TNT, {
        x: x + TNT_SPAWN_OFFSET.x,
        y: y + TNT_SPAWN_OFFSET.y,
        z: z + TNT_SPAWN_OFFSET.z,
      });
      if (entity?.isValid) block.setType("minecraft:air");
    } catch {} // chunk unloaded
  },
  { blockTypes: [TNT] },
);

world.afterEvents.playerLeave.subscribe(({ playerId }) => {
  cdMap.delete(playerId);
});
