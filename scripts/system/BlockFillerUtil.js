// Constants
// โหมดการเติมบล็อกหลักของระบบ
export const MODE = Object.freeze({
  CLEAR: 0,
  ORE: 1,
  NETHER: 2,
  CONCRETE: 3,
  RANDOM: 4,
});

export const END_SEQUENCE_STATE = Object.freeze({
  INITIAL_WAIT: 0,
  PATTERN3: 1,
  PATTERN1: 2,
  COOLDOWN: 3,
  PATTERN2: 4,
  COMPLETED: 5,
});

// BLOCK SOURCE
// รายชื่อบล็อกต้นทางที่ใช้สุ่มหรือใช้เป็นค่าเริ่มต้นของแต่ละหมวด
export const BLOCK_CATEGORIES = Object.freeze({
  ore: [
    "minecraft:coal_ore",
    "minecraft:iron_ore",
    "minecraft:copper_ore",
    "minecraft:gold_ore",
    "minecraft:redstone_ore",
    "minecraft:lapis_ore",
    "minecraft:diamond_ore",
    "minecraft:emerald_ore",
  ],
  nether: ["minecraft:ancient_debris", "minecraft:magma", "minecraft:blackstone"],
  concrete: [
    "minecraft:white_concrete",
    "minecraft:orange_concrete",
    "minecraft:magenta_concrete",
    "minecraft:light_blue_concrete",
    "minecraft:yellow_concrete",
    "minecraft:lime_concrete",
    "minecraft:pink_concrete",
    "minecraft:gray_concrete",
    "minecraft:light_gray_concrete",
    "minecraft:cyan_concrete",
    "minecraft:purple_concrete",
    "minecraft:blue_concrete",
    "minecraft:brown_concrete",
    "minecraft:green_concrete",
    "minecraft:red_concrete",
    "minecraft:black_concrete",
  ],
  random: [
    "minecraft:obsidian",
    "minecraft:crying_obsidian",
    "minecraft:amethyst_block",
    "minecraft:calcite",
    "minecraft:deepslate",
    "minecraft:basalt",
  ],
});
