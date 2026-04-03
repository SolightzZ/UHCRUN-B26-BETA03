// ============================================================
// ** สเปคเครื่องผู้พัฒนา
// ============================================================
// CPU   : Intel Core i5-13420H
// RAM   : 32GB DDR5 5200MHz
// SSD   : NVMe (Samsung 512GB)
// GPU   : NVIDIA GeForce RTX 4050 Laptop
//
// ============================================================

// จำนวนผู้เล่น:
// - รองรับ 1–30 คน ต่อ match (single session)
//
// รูปแบบทีม:
// - Solo   (1 คน/ทีม)
// - Duo    (2 คน/ทีม)
// - Trio   (3 คน/ทีม)
// - Squad  (4 คน/ทีม)
// - Custom (5 คน/ทีม)
//
// ============================================================

// Commmands
import "./customCommand/command.js";

// Plugins
import "./plugin/AutoSmelt.js";
import "./plugin/ItemPickup.js";
import "./plugin/blockInteractGuard.js";
import "./plugin/Knockback.js";
import "./plugin/plateKnockback.js";
import "./plugin/anticheat_cps.js";
import "./plugin/tnt_instant.js";
import "./plugin/projectile_hit_sounds.js";
import "./plugin/enchant.js";
import "./plugin/fishing_hod.js";
import "./plugin/axe.js";
import "./plugin/ItemConsumeEffects.js";

// System Games
import "./system/border.js";

// Team Manager
import "./Manager/TeamManager.js";

// Leaderboard
import "./Manager/Leaderboard.js";
