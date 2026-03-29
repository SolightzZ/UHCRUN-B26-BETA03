import { world, system } from "@minecraft/server";

const MAX_CPS = 20;
const HARD_LIMIT = 24;
const WINDOW_TICKS = 20;
const BUF_SIZE = HARD_LIMIT;

const playerState = new Map();

function createPlayerData() {
  return {
    buf: new Int32Array(BUF_SIZE),
    head: 0,
    count: 0,
  };
}

function countRecentHits(data, currentTick) {
  const cutoff = currentTick - WINDOW_TICKS;
  let validCount = 0;
  for (let i = 0; i < data.count; i++) {
    const idx = (data.head - 1 - i + BUF_SIZE) % BUF_SIZE;
    if (data.buf[idx] > cutoff) validCount++;
    else break;
  }
  return validCount;
}

function kickPlayer(player, cps) {
  const name = player.name;
  const safeName = name.replace(/"/g, '\\"');
  const kickMessage = `\nUHCRun\n§c[CPS] ${name} ${cps}/${MAX_CPS} (Auto-cheat)`;
  console.warn(`[CPS] ${name} kicked: ${cps} hits/${WINDOW_TICKS} ticks`);
  system.run(() => {
    if (!player?.isValid) return;
    player.dimension.runCommand(`kick "${safeName}" ${kickMessage}`).catch(() => {});
  });
}

world.afterEvents.playerLeave.subscribe(({ playerId }) => {
  playerState.delete(playerId);
});

world.afterEvents.entityHitEntity.subscribe((event) => {
  const attacker = event.damagingEntity;
  if (!attacker || attacker.typeId !== "minecraft:player") return;

  const currentTick = system.currentTick;
  const playerId = attacker.id;

  let data = playerState.get(playerId);
  if (!data) {
    data = createPlayerData();
    playerState.set(playerId, data);
  }

  data.buf[data.head] = currentTick;
  data.head = (data.head + 1) % BUF_SIZE;
  if (data.count < BUF_SIZE) data.count++;

  const cps = countRecentHits(data, currentTick);
  if (cps < HARD_LIMIT) return;

  kickPlayer(attacker, cps);

  data.buf.fill(0);
  data.head = 0;
  data.count = 0;
});
