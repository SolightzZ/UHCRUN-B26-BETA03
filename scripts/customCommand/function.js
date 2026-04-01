import {
  world,
  system,
  GameMode,
  EffectTypes,
  InputPermissionCategory,
  Difficulty,
  ItemStack,
  ObjectiveSortOrder,
  DisplaySlotId,
  CommandPermissionLevel,
} from "@minecraft/server";
import { startGameUhc, endGameUhc, resetGameUhc } from "../system/border";
import { tpa, openMainMenu } from "../Manager/TeamManager";

// config
const config = {
  setup: [
    { type: "regeneration", duration: 500 },
    { type: "resistance", duration: 500 },
    { type: "saturation", duration: 500 },
  ],
};

function dim() {
  return world.getDimension("overworld");
}

function batch({ step, budget = 2, interval = 2 }) {
  const players = world.getPlayers();
  let index = 0;
  const id = system.runInterval(() => {
    let processed = 0;
    for (; index < players.length && processed < budget; index++) {
      step(players[index]);
      processed++;
    }
    if (index >= players.length) system.clearRun(id);
  }, interval);
}

// utils
function cmd(commandString) {
  dim().runCommand(commandString);
}

function kit(player) {
  const invComp = player.getComponent("inventory");
  if (!invComp) return;

  const inventory = invComp.container;
  inventory.clearAll();
  inventory.setItem(0, new ItemStack("minecraft:compass", 1));
}

function effect(player, effects) {
  for (const effectData of effects) {
    const eff = EffectTypes.get(effectData.type);
    if (!eff) continue;

    player.addEffect(eff, effectData.duration, {
      amplifier: effectData.amp ?? 255,
      showParticles: false,
    });
  }
}
function spawn(player) {
  player.playSound("spawn");
  player.setGameMode(GameMode.Adventure);
  player.inputPermissions.setPermissionCategory(InputPermissionCategory.Movement, true);
  player.teleport({ x: 596, y: 130, z: 609 }, { dimension: dim() });
}

function spectate(player) {
  if (!player.hasTag("uhc")) {
    player.setGameMode(GameMode.Spectator);
    player.inputPermissions.setPermissionCategory(InputPermissionCategory.Movement, true);
  }
}

// pipelines
export function setup(player) {
  kit(player);
  spawn(player);
  effect(player, config.setup);
}

export function reset(player) {
  kit(player);
  spawn(player);
  effect(player, config.setup);
}

export function start(player) {
  player.playAnimation("animation.armor_stand.athena_pose");
  player.resetLevel();
  effect(player, [{ type: "conduit_power", duration: 99999, amp: 0 }]);
  spectate(player);
}

export function end(player) {
  kit(player);
  effect(player, [{ type: "regeneration", duration: 255 }]);
  player.resetLevel();
  player.inputPermissions.setPermissionCategory(InputPermissionCategory.Movement, true);
}

function setSidebar() {
  const scoreboard = world.scoreboard;
  const objective = scoreboard.getObjective("uhc");

  if (!objective) return;

  scoreboard.setObjectiveAtDisplaySlot(DisplaySlotId.Sidebar, {
    objective: objective,
    sortOrder: ObjectiveSortOrder.Descending,
  });
}

// commands
function uhcSetup() {
  world.sendMessage(
    "§7------- UHCRun Season 2 -------\n" +
      "§f Official Competitive UHC Event\n" +
      "§f Hosted by Sleeplite Server\n" +
      "§9 Community: discord.gg/gtqfbmvTJK\n" +
      "§7------------------------------",
  );

  cmd("structure load uhc1 569 100 569");
  cmd("tickingarea add -80 0 -80 79 255 79 center");
  cmd("tickingarea add -80 0 80 79 255 239 north");
  cmd("tickingarea add -80 0 -240 79 255 -81 south");
  cmd("tickingarea add 80 0 -80 239 255 79 east");
  cmd("tickingarea add -240 0 -80 -81 255 79 west");
  cmd("tickingarea add 80 0 80 239 255 239 ne");
  cmd("tickingarea add -240 0 80 -81 255 239 nw");
  cmd("tickingarea add 80 0 -240 239 255 -81 se");
  cmd("tickingarea add -240 0 -240 -81 255 -81 sw");
  cmd("tickingarea add -80 0 240 79 255 399 far_north");
  cmd("setworldspawn 596 125 622");
  cmd("clearspawnpoint @a");

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
  world.gameRules.spawnRadius = 5;
  world.gameRules.pvp = false;
  world.gameRules.locatorBar = false;

  world.setDifficulty(Difficulty.Peaceful);

  batch({ step: setup, budget: 1, interval: 5 });
}

function uhcreset() {
  world.sendMessage("[UHC] Reset complete.");
  cmd("clearspawnpoint @a");
  cmd("setworldspawn 595 126 624");
  cmd("tag @a remove uhc");
  resetGameUhc();

  world.gameRules.naturalRegeneration = true;
  world.gameRules.showCoordinates = false;
  world.gameRules.doMobSpawning = false;
  world.gameRules.mobGriefing = false;
  world.gameRules.fallDamage = false;
  world.gameRules.doMobLoot = false;
  world.gameRules.pvp = false;

  world.setDifficulty(Difficulty.Peaceful);

  batch({ step: reset, budget: 1, interval: 3 });
}

function uhcStart() {
  cmd("daylock false");
  cmd("setworldspawn 0 100 0");
  startGameUhc();
  setSidebar();

  world.gameRules.naturalRegeneration = false;
  world.gameRules.showCoordinates = true;
  world.gameRules.doMobSpawning = true;
  world.gameRules.mobGriefing = true;
  world.gameRules.fallDamage = true;
  world.gameRules.doMobLoot = true;
  world.gameRules.pvp = false;

  world.setDifficulty(Difficulty.Normal);
  world.setTimeOfDay(22999);

  batch({ step: start, budget: 1, interval: 5 });
}

function uhcEnd() {
  world.sendMessage("[UHC] The game is over.");
  cmd("clearspawnpoint @a");
  cmd("effect @a clear");
  endGameUhc();

  world.gameRules.pvp = false;
  world.gameRules.fallDamage = false;
  world.gameRules.mobGriefing = false;
  world.gameRules.showCoordinates = false;
  world.gameRules.naturalRegeneration = true;

  world.setDifficulty(Difficulty.Peaceful);

  batch({ step: end, budget: 1, interval: 5 });
}

export const CommandMap = {
  "addon:uhcsetup": {
    handler: uhcSetup,
    permission: CommandPermissionLevel.GameDirectors,
  },
  "addon:uhcreset": {
    handler: uhcreset,
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
