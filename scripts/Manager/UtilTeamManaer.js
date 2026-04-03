// ======================================================
// CONFIG (ค่าคงที่ระบบ UHC)
// ======================================================
export const CONFIG = Object.freeze({
  adminTag: "admin",
  uhcTag: "uhc",
  objectiveName: "uhcBoard",
  displayName: "UHC",
  title: "§g§r",
  key: "team", // DynamicProperty: { playerId → teamId }
});

// ======================================================
// TEAMS (config ทีมทั้งหมด)
// ======================================================
export const TEAMS = Object.freeze([
  { id: "team1", name: "Red", color: "§c", icon: "textures/items/dye_powder_red" },
  { id: "team2", name: "Blue", color: "§9", icon: "textures/items/dye_powder_blue_new" },
  { id: "team3", name: "Yellow", color: "§e", icon: "textures/items/dye_powder_yellow" },
  { id: "team4", name: "Green", color: "§a", icon: "textures/items/dye_powder_lime" },
  { id: "team5", name: "Purple", color: "§5", icon: "textures/items/dye_powder_purple" },
  { id: "team6", name: "Aqua", color: "§b", icon: "textures/items/dye_powder_light_blue" },
  { id: "team7", name: "Orange", color: "§6", icon: "textures/items/dye_powder_orange" },
  { id: "team8", name: "Gray", color: "§7", icon: "textures/items/dye_powder_silver" },
  { id: "team9", name: "Pink", color: "§d", icon: "textures/items/dye_powder_pink" },
]);
