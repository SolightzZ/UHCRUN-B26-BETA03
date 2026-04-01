import { world, system } from "@minecraft/server";

// @ts-ignore
import {
  getTeamStats,
  getTeamInfo,
  getTeamKillObjective,
  getPlayerStats,
  getPlayerName,
} from "../Manager/TeamManager.js";

// ── Config ───────────────────────────────────────────────────────────────────

const MAX_PLAYERS = 10;
const MAX_TEAMS   = 9;

/** Render interval ใน tick (100 tick = 5 วินาที) */
const RENDER_INTERVAL_TICKS = 100;

const UI = Object.freeze({
  HEAD:  `§g§l--- [ UHCRUN LEADERBOARD ] ---\n\n`,
  FOOT:  `\n§g-----------------------------------`,
  RANKS: ["§6", "§7", "§c", "§f"],
});

/**
 * พิกัด NPC สำหรับ Leaderboard แต่ละประเภท
 * เก็บรวมที่นี่แห่งเดียว — แก้ไขตรงนี้เมื่อย้ายแผนที่
 */
const NPCS = Object.freeze([
  { tag: "lb_players", x: 596.5, y: 127, z: 601.5 },
  { tag: "lb_teams",   x: 593.5, y: 127, z: 600.5 },
  { tag: "lb_deaths",  x: 599.5, y: 127, z: 600.5 },
]);

// ── Helpers ──────────────────────────────────────────────────────────────────

function isAdmin(player) {
  return player?.isValid && player.hasTag("admin");
}

function isLeaderboardNpc(entity) {
  return (
    entity.hasTag("lb_players") ||
    entity.hasTag("lb_teams")   ||
    entity.hasTag("lb_deaths")
  );
}

// ── Stats Builders ───────────────────────────────────────────────────────────

function getStats() {
  const raw = getPlayerStats();
  const map = new Map();
  if (!raw?.size) return map;

  for (const [id, st] of raw) {
    if (!st.kills && !st.deaths) continue;
    const name = getPlayerName(id) ?? id;
    map.set(name, { kills: st.kills, deaths: st.deaths });
  }
  return map;
}

function getPlayerText(statsMap) {
  const list = [];
  for (const [name, st] of statsMap) {
    if (st.kills || st.deaths) list.push({ name, st });
  }

  if (!list.length) {
    return `§eTop ${MAX_PLAYERS} Players (Kills)\n\n§7... data? ...\n`;
  }

  list.sort((a, b) => b.st.kills - a.st.kills);

  let text = `§eTop ${MAX_PLAYERS} Players (Kills)\n\n`;
  for (let i = 0; i < Math.min(list.length, MAX_PLAYERS); i++) {
    const { name, st } = list[i];
    const color = UI.RANKS[i] ?? UI.RANKS[3];
    text += `${color}#${i + 1} §a${name} §f- §c${st.kills} Kills §8(§4${st.deaths} Deaths§8)\n`;
  }
  return text;
}

function getTeamText() {
  const build = (list) => {
    if (!list.length) return `§bTop Team Kills\n\n§7... data? ...\n`;

    let text = `§bTop Team Kills\n\n`;
    for (let i = 0; i < list.length; i++) {
      const color = UI.RANKS[i] ?? UI.RANKS[3];
      text += `${color}#${i + 1} ${list[i].name} §f: §c${list[i].kills} Kills\n`;
    }
    return text;
  };

  const obj = getTeamKillObjective();
  if (obj) {
    const scores = obj.getScores();
    if (!scores?.length) return build([]);

    const list = scores
      .map((s) => ({ name: s.participant.displayName, kills: s.score }))
      .filter((s) => s.kills > 0)
      .sort((a, b) => b.kills - a.kills)
      .slice(0, MAX_TEAMS);

    return build(list);
  }

  const tStats = getTeamStats();
  if (!tStats?.size) return build([]);

  const list = [];
  for (const [id, st] of tStats) {
    if (!(st.kills || st.deaths)) continue;
    const info = getTeamInfo(id);
    const name = info ? `${info.color}${info.name}` : `§f${id}`;
    list.push({ name, kills: st.kills });
  }
  list.sort((a, b) => b.kills - a.kills);
  return build(list.slice(0, MAX_TEAMS));
}

function getDeathsText(statsMap) {
  let topName = "None";
  let max = 0;

  for (const [name, st] of statsMap) {
    if (st.deaths > max) {
      max = st.deaths;
      topName = name;
    }
  }
  return `§cTop Deaths: §7${topName} (${max})§r\n`;
}

// ── Render ───────────────────────────────────────────────────────────────────

let lastRenderTick = 0;

export function renderBoard() {
  if (system.currentTick - lastRenderTick < RENDER_INTERVAL_TICKS) return;
  lastRenderTick = system.currentTick;

  const dim = world.getDimension("overworld");

  let pNpcs, tNpcs, dNpcs;
  try {
    pNpcs = dim.getEntities({ type: "minecraft:npc", tags: ["lb_players"] });
    tNpcs = dim.getEntities({ type: "minecraft:npc", tags: ["lb_teams"]   });
    dNpcs = dim.getEntities({ type: "minecraft:npc", tags: ["lb_deaths"]  });
  } catch {
    return;
  }

  if (!pNpcs.length && !tNpcs.length && !dNpcs.length) return;

  const stats = getStats();

  if (pNpcs.length) updateNpcText(pNpcs, UI.HEAD + getPlayerText(stats) + UI.FOOT);
  if (tNpcs.length) updateNpcText(tNpcs, UI.HEAD + getTeamText()          + UI.FOOT);
  if (dNpcs.length) updateNpcText(dNpcs, UI.HEAD + getDeathsText(stats)   + UI.FOOT);
}

function updateNpcText(npcs, text) {
  for (const npc of npcs) {
    if (!npc?.isValid) continue;
    if (npc.nameTag !== text) npc.nameTag = text;
  }
}

// ── Spawn ────────────────────────────────────────────────────────────────────

export function spawnLeaderboardNPC() {
  const dim = world.getDimension("overworld");

  system.runTimeout(() => {
    for (const cfg of NPCS) {
      // ลบ NPC เดิม
      const existing = dim.getEntities({ type: "minecraft:npc", tags: [cfg.tag] });
      for (const npc of existing) npc.remove();

      // spawn ใหม่
      try {
        const newNpc = dim.spawnEntity("minecraft:npc", {
          x: cfg.x,
          y: cfg.y,
          z: cfg.z,
        });
        newNpc.addTag(cfg.tag);
      } catch {
        console.warn("[Leaderboard] Chunk not loaded at spawn point:", cfg.x, cfg.y, cfg.z);
      }
    }
  }, 20);
}

// ── Interaction ──────────────────────────────────────────────────────────────

world.beforeEvents.playerInteractWithEntity.subscribe((ev) => {
  const { target, player } = ev;

  if (!target || target.typeId !== "minecraft:npc") return;
  if (!isLeaderboardNpc(target)) return;

  ev.cancel = true;

  if (!isAdmin(player)) {
    player.onScreenDisplay.setActionBar("You don't have permission");
    return;
  }

  system.run(() => {
    if (!player?.isValid) return;
    if (player.isSneaking) {
      renderBoard();
      player.playSound("random.orb", { volume: 0.5, pitch: 1 });
      player.onScreenDisplay.setActionBar("§aLeaderboard Updated!");
    }
  });
});

// Initial render หลัง world โหลด
system.run(() => {
  renderBoard();
});
