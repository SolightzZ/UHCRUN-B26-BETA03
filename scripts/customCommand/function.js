import { world, system, GameMode, InputPermissionCategory, Difficulty, ItemStack, CommandPermissionLevel } from "@minecraft/server";
import { startGameUhc, endGameUhc, resetGameUhc } from "../system/border";
import { tpa, openMainMenu } from "../Manager/TeamManager";
import { spawnLeaderboardNPC, updateLeaderboard } from "../Manager/Leaderboard.js";

//=================================
// CONFIG
//=================================

export const SPAWN_CONFIG = Object.freeze({
  x: 596,
  y: 130,
  z: 609,
  dimension: "overworld",
});

const SETUP_RESET_EFFECTS = Object.freeze([
  { type: "regeneration", duration: 500 },
  { type: "resistance", duration: 500 },
  { type: "saturation", duration: 500 },
]);

//=================================
// CORE UTILITIES
//=================================

/**
 * วนลูปทำงานกับผู้เล่นทีละชุด
 * ดึง world.getPlayers() ใหม่ทุก tick เพื่อหลีกเลี่ยง stale reference
 * เมื่อผู้เล่น disconnect ระหว่างทำงาน
 */
function batch({ step, budget = 1 }) {
  // ไม่เก็บ snapshot ไว้นอก — ดึง fresh list และ index แบบ closure
  const players = world.getPlayers();
  let i = 0;
  const run = system.runInterval(() => {
    // ดึงใหม่ทุกรอบเพื่อให้ list เป็น live
    // reset index ถ้า list ใหม่สั้นกว่า (เช่น มีคน disconnect)
    if (i >= players.length) {
      system.clearRun(run);
      return;
    }
    for (let n = 0; n < budget && i < players.length; n++, i++) {
      const player = players[i];
      // guard ก่อนทุกครั้งเพื่อป้องกัน stale object
      if (!player?.isValid) continue;
      try {
        step(player);
      } catch (e) {
        console.warn(`[batch] step error for player index ${i}:`, e);
      }
    }
    if (i >= players.length) system.clearRun(run);
  }, 2);
}

// รันคำสั่งใน overworld
function cmd(commandString) {
  world.getDimension(SPAWN_CONFIG.dimension).runCommand(commandString);
}

//==================================
// PLAYER STATE CONTROL
//==================================

function setItemPlayer(player) {
  const invComp = player.getComponent("inventory");
  if (!invComp) return;
  invComp.container.clearAll();
  invComp.container.setItem(0, new ItemStack("minecraft:compass", 1));
}

function applyEffects(player, effects = []) {
  for (const { type, duration, amp = 0 } of effects) {
    player.addEffect(type, duration, { amplifier: amp, showParticles: false });
  }
}

function setPlayerSpawn(player) {
  player.playSound("spawn");
  player.setGameMode(GameMode.Adventure);
  player.inputPermissions.setPermissionCategory(InputPermissionCategory.Movement, true);
  player.teleport({ x: SPAWN_CONFIG.x, y: SPAWN_CONFIG.y, z: SPAWN_CONFIG.z }, { dimension: world.getDimension(SPAWN_CONFIG.dimension) });
}

//==================================
// PLAYER PIPELINES
//==================================

/** ใช้ร่วมกันระหว่าง setup และ reset เพราะ logic เหมือนกัน 100% */
function setupOrReset(player) {
  setItemPlayer(player);
  setPlayerSpawn(player);
  applyEffects(player, SETUP_RESET_EFFECTS);
}

// alias ชัดเจนสำหรับแต่ละ lifecycle
const setup = setupOrReset;
const reset = setupOrReset;

function end(player) {
  setItemPlayer(player);
  applyEffects(player, [{ type: "regeneration", duration: 255 }]);
  player.addLevels(-10000);

  player.inputPermissions.setPermissionCategory(InputPermissionCategory.Movement, true);
}

//==================================
// TICKING AREA SETUP
//==================================

const TICKING_AREAS = Object.freeze([
  ["tickingarea add -80 0 -80 79 255 79 center"],
  ["tickingarea add -80 0 80 79 255 239 north"],
  ["tickingarea add -80 0 -240 79 255 -81 south"],
  ["tickingarea add 80 0 -80 239 255 79 east"],
  ["tickingarea add -240 0 -80 -81 255 79 west"],
  ["tickingarea add 80 0 80 239 255 239 ne"],
  ["tickingarea add -240 0 80 -81 255 239 nw"],
  ["tickingarea add 80 0 -240 239 255 -81 se"],
  ["tickingarea add -240 0 -240 -81 255 -81 sw"],
  ["tickingarea add -80 0 240 79 255 399 far_north"],
]);

//==================================
// UHC WORLD LIFECYCLE
//==================================

function uhcSetup() {
  world.sendMessage(
    "§7------------ UHCRun26 -----------\n" +
      "§f Battle. Survive. Win.\n" +
      "§f Presented by Sleeplite SMP\n" +
      "§9Join the community > discord.gg/gtqfbmvTJK\n" +
      "§7------------------------------",
  );

  cmd("structure load uhc1 569 100 569");
  for (const [tickCmd] of TICKING_AREAS) cmd(tickCmd);

  world.gameRules.sendCommandFeedback = false;
  world.gameRules.commandBlockOutput = false;
  world.gameRules.naturalRegeneration = true;
  world.gameRules.doImmediateRespawn = true;
  world.gameRules.showCoordinates = false;
  world.gameRules.doWeatherCycle = false;
  world.gameRules.doMobSpawning = false;
  world.gameRules.mobGriefing = false;
  world.gameRules.fallDamage = false;
  world.gameRules.doMobLoot = false;
  world.gameRules.spawnRadius = 1;
  world.gameRules.pvp = false;
  world.gameRules.locatorBar = false;
  world.setDifficulty(Difficulty.Peaceful);

  cmd("clearspawnpoint @a");
  cmd("setworldspawn 596 125 622");
  cmd("effect @a clear");
  batch({ step: setup, budget: 1 });

  spawnLeaderboardNPC();
  updateLeaderboard();
}

function uhcReset() {
  world.sendMessage("[UHC] Reset complete.");

  resetGameUhc();

  world.gameRules.naturalRegeneration = true;
  world.gameRules.showCoordinates = false;
  world.gameRules.doMobSpawning = false;
  world.gameRules.mobGriefing = false;
  world.gameRules.fallDamage = false;
  world.gameRules.doMobLoot = false;
  world.gameRules.pvp = false;
  world.setDifficulty(Difficulty.Peaceful);

  cmd("clearspawnpoint @a");
  cmd("setworldspawn 596 125 622");

  batch({ step: reset, budget: 1 });

  spawnLeaderboardNPC();
  updateLeaderboard();
}

function uhcStart() {
  cmd("daylock false");

  startGameUhc();

  world.gameRules.naturalRegeneration = false;
  world.gameRules.showCoordinates = true;
  world.gameRules.doMobSpawning = true;
  world.gameRules.mobGriefing = true;
  world.gameRules.fallDamage = true;
  world.gameRules.doMobLoot = true;
  world.gameRules.pvp = false;
  world.setDifficulty(Difficulty.Normal);
  world.setTimeOfDay(22999);

  cmd("clearspawnpoint @a");
  cmd("setworldspawn 0 100 0");
}

function uhcEnd() {
  world.sendMessage("[UHC] The game is over.");
  cmd("effect @a clear");

  endGameUhc();

  world.gameRules.pvp = false;
  world.gameRules.fallDamage = false;
  world.gameRules.mobGriefing = false;
  world.gameRules.showCoordinates = false;
  world.gameRules.naturalRegeneration = true;
  world.setDifficulty(Difficulty.Peaceful);

  cmd("clearspawnpoint @a");
  cmd("setworldspawn 596 125 622");
  batch({ step: end, budget: 1 });
}

//==================================
// COMMAND REGISTRY
//==================================

export const CommandMap = {
  "addon:uhcsetup": {
    handler: uhcSetup,
    permission: CommandPermissionLevel.GameDirectors,
  },
  "addon:uhcreset": {
    handler: uhcReset,
    permission: CommandPermissionLevel.GameDirectors,
  },
  "addon:uhcstart": {
    handler: uhcStart,
    permission: CommandPermissionLevel.GameDirectors,
  },
  "addon:uhcend": {
    handler: uhcEnd,
    permission: CommandPermissionLevel.GameDirectors,
  },
  "addon:tpa": {
    handler: tpa,
    permission: CommandPermissionLevel.Any,
  },
  "addon:gui": {
    handler: openMainMenu,
    permission: CommandPermissionLevel.GameDirectors,
  },
};
