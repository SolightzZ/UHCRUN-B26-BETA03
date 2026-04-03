import { world, system } from "@minecraft/server";

// @ts-ignore
import {
  getPlayerName,
  getPlayerStats,
  getKdHistoryObjective,
  getPlayersByTeam,
  getTeamInfo,
  getTeamKillObjective,
  getTeams,
  getTeamStats,
  refreshPlayerCaches,
} from "../Manager/TeamManager.js";

const MAX_PLAYERS = 10;
const MAX_TEAMS = 10;
const RENDER_INTERVAL_TICKS = 100;

const UI = Object.freeze({
  HEAD: "§g§l--- [ UHCRUN LEADERBOARD ] ---\n\n",
  FOOT: "\n§g-----------------------------------",
  RANKS: ["§6", "§7", "§c", "§f"],
});

const NPCS = Object.freeze([
  { tag: "lb_players", x: 596.5, y: 127, z: 601.5 },
  { tag: "lb_teams", x: 593.5, y: 127, z: 600.5 },
  { tag: "lb_deaths", x: 599.5, y: 127, z: 600.5 },
]);

let lastRenderTick = 0;
const leaderboardInteractQueue = [];
let leaderboardInteractScheduled = false;

function getRankColor(index) {
  if (index < UI.RANKS.length) {
    return UI.RANKS[index];
  } else {
    return UI.RANKS[3];
  }
}

// ตรวจสอบว่าเอนทิตีนั้นเป็น NPC ในลีดเดอร์บอร์ดหรือไม่ และส่งคืนแท็กของเอนทิตีนั้น
function getLeaderboardNpcTag(entity) {
  if (!entity || !entity.isValid) return "";

  if (entity.hasTag("lb_players")) return "lb_players";
  if (entity.hasTag("lb_teams")) return "lb_teams";
  if (entity.hasTag("lb_deaths")) return "lb_deaths";

  return "";
}

function getStats() {
  const objectiveStats = getObjectivePlayerStats();
  if (objectiveStats.size) return objectiveStats;

  const raw = getPlayerStats();
  const map = new Map();
  if (!raw || !raw.size) return map;

  for (const [id, st] of raw) {
    let kills;
    if (st && st.kills !== undefined) {
      kills = st.kills;
    } else {
      kills = 0;
    }

    let deaths;
    if (st && st.deaths !== undefined) {
      deaths = st.deaths;
    } else {
      deaths = 0;
    }

    if (!kills && !deaths) continue;

    let name;
    if (getPlayerName(id)) {
      name = getPlayerName(id);
    } else {
      name = id;
    }

    let teamInfo;
    if (st && st.teamId) {
      teamInfo = getTeamInfo(st.teamId);
    } else {
      teamInfo = null;
    }

    let teamId;
    if (st && st.teamId !== undefined) {
      teamId = st.teamId;
    } else {
      teamId = null;
    }

    let teamLabel;
    if (teamInfo) {
      teamLabel = `${teamInfo.color}${teamInfo.name}`;
    } else {
      teamLabel = null;
    }

    map.set(name, {
      kills,
      deaths,
      teamId,
      teamLabel,
    });
  }

  return map;
}

function processScoreEntry(score, map) {
  let value;
  if (score && score.score !== undefined) {
    value = score.score;
  } else {
    value = 0;
  }

  if (value <= 0) return;

  let key;
  if (score && score.participant && score.participant.displayName) {
    key = score.participant.displayName;
  } else {
    return;
  }

  const parts = key.split(" | Victim : ");
  if (parts.length !== 2) return;

  const killerName = parts[0].replace("Kill: ", "").trim();
  const victimName = parts[1].trim();
  if (!killerName || !victimName) return;

  let killerEntry;
  if (map.has(killerName)) {
    killerEntry = map.get(killerName);
  } else {
    killerEntry = { kills: 0, deaths: 0, teamId: null, teamLabel: null };
  }
  killerEntry.kills += value;
  map.set(killerName, killerEntry);

  let victimEntry;
  if (map.has(victimName)) {
    victimEntry = map.get(victimName);
  } else {
    victimEntry = { kills: 0, deaths: 0, teamId: null, teamLabel: null };
  }
  victimEntry.deaths += value;
  map.set(victimName, victimEntry);
}

function getObjectivePlayerStats() {
  const obj = getKdHistoryObjective();
  const map = new Map();
  if (!obj) return map;

  const scores = obj.getScores();
  if (!scores || !scores.length) return map;

  for (let i = 0; i < scores.length; i++) {
    processScoreEntry(scores[i], map);
  }

  return map;
}

function buildEmptyPlayerText() {
  return `§eTop ${MAX_PLAYERS} Players (Kills)\n\n§7None (0)\n`;
}

// สร้างรายการผู้เล่นที่เรียงลำดับแล้วเพื่อแสดงผลในตารางคะแนน
function getPlayerText(statsMap) {
  const list = [];

  // สร้างรายชื่อผู้เล่นพร้อมจำนวนการสังหาร/การตาย
  for (const [name, st] of statsMap) {
    if (!st.kills && !st.deaths) continue;
    list.push({ name, st });
  }

  list.sort((a, b) => b.st.kills - a.st.kills || a.name.localeCompare(b.name));
  if (list.length > MAX_PLAYERS) list.length = MAX_PLAYERS;
  if (!list.length) return buildEmptyPlayerText();

  let text = `§eTop ${MAX_PLAYERS} Players (Kills)\n\n`;
  for (let i = 0; i < list.length; i++) {
    const item = list[i];
    const color = getRankColor(i);

    let teamSuffix;
    if (item.st.teamLabel) {
      teamSuffix = ` §8[${item.st.teamLabel}§8]`;
    } else {
      teamSuffix = "";
    }

    text += `${color}#${i + 1} §a${item.name}${teamSuffix} §f- §c${item.st.kills} Kills §8(§4${item.st.deaths} Deaths§8)\n`;
  }

  return text;
}

function buildEmptyTeamText() {
  return `§bTop ${MAX_TEAMS} Teams (Kills)\n\n§7None (0)\n`;
}

function buildTeamText(list) {
  if (!list.length) return buildEmptyTeamText();

  let text = `§bTop ${MAX_TEAMS} Teams (Kills)\n\n`;
  for (let i = 0; i < list.length; i++) {
    const color = getRankColor(i);

    let members;
    if (list[i].members !== undefined) {
      members = list[i].members;
    } else {
      members = 0;
    }

    text += `${color}#${i + 1} ${list[i].name} §f: §c${list[i].kills} Kills §7(${members} Players)\n`;
  }

  return text;
}

function getObjectiveTeamList(obj) {
  const scores = obj.getScores();
  const teams = getTeams();
  const list = [];

  console.warn("[DEBUG] getObjectiveTeamList - scores length:", scores ? scores.length : 0);

  if (!scores || !scores.length) return list;

  for (let i = 0; i < scores.length; i++) {
    const score = scores[i];
    let displayName;
    if (score && score.participant && score.participant.displayName) {
      displayName = score.participant.displayName;
    } else {
      continue;
    }

    const scoreValue = score.score;

    console.warn(`[DEBUG] Score: "${displayName}" = ${scoreValue}`);

    if (scoreValue <= 0) continue;

    let matchedTeam = null;
    for (let j = 0; j < teams.length; j++) {
      const label = `${teams[j].color}${teams[j].name}`;
      if (displayName === label) {
        matchedTeam = teams[j];
        break;
      }
    }

    if (!matchedTeam) {
      console.warn(`[DEBUG] No team matched for displayName: "${displayName}"`);
      continue;
    }

    list.push({
      name: displayName,
      kills: scoreValue,
      members: getPlayersByTeam(matchedTeam.id).length,
      order: teams.findIndex((team) => team.id === matchedTeam.id),
    });
  }

  console.warn("[DEBUG] Final objective list:", list.length, list);

  list.sort((a, b) => b.kills - a.kills || a.order - b.order);
  if (list.length > MAX_TEAMS) list.length = MAX_TEAMS;
  return list;
}

function getRuntimeTeamList() {
  const teams = getTeams();
  const tStats = getTeamStats();
  const list = [];
  if (!teams || !teams.length) return list;

  for (let i = 0; i < teams.length; i++) {
    const team = teams[i];

    let st;
    if (tStats && tStats.size) {
      st = tStats.get(team.id);
    } else {
      st = null;
    }

    const members = getPlayersByTeam(team.id).length;

    let kills;
    if (st && st.kills !== undefined) {
      kills = st.kills;
    } else {
      kills = 0;
    }

    list.push({
      name: `${team.color}${team.name}`,
      kills,
      members,
      order: i,
    });
  }

  list.sort((a, b) => b.kills - a.kills || a.order - b.order);
  if (list.length > MAX_TEAMS) list.length = MAX_TEAMS;
  return list;
}

function getTeamText() {
  const obj = getTeamKillObjective();
  if (obj) {
    const objectiveList = getObjectiveTeamList(obj);
    if (objectiveList.length) return buildTeamText(objectiveList);
  }

  return buildTeamText(getRuntimeTeamList());
}

function buildEmptyDeathsText() {
  return `§cTop ${MAX_PLAYERS} Deaths\n\n§7None (0)\n`;
}

function getDeathsText(statsMap) {
  const list = [];

  for (const [name, st] of statsMap) {
    if (!st.deaths) continue;
    list.push({ name, st });
  }

  list.sort((a, b) => b.st.deaths - a.st.deaths || a.name.localeCompare(b.name));
  if (list.length > MAX_PLAYERS) list.length = MAX_PLAYERS;
  if (!list.length) return buildEmptyDeathsText();

  let text = `§cTop ${MAX_PLAYERS} Deaths\n\n`;
  for (let i = 0; i < list.length; i++) {
    const item = list[i];
    const color = getRankColor(i);

    let teamSuffix;
    if (item.st.teamLabel) {
      teamSuffix = ` §8[${item.st.teamLabel}§8]`;
    } else {
      teamSuffix = "";
    }

    text += `${color}#${i + 1} §a${item.name}${teamSuffix} §f- §4${item.st.deaths} Deaths §8(§c${item.st.kills} Kills§8)\n`;
  }

  return text;
}

function collectNpcsByTag(npcs) {
  const pNpcs = [];
  const tNpcs = [];
  const dNpcs = [];

  for (let i = 0; i < npcs.length; i++) {
    const npc = npcs[i];
    if (!npc || !npc.isValid) continue;

    const tag = getLeaderboardNpcTag(npc);
    if (tag === "lb_players") {
      pNpcs.push(npc);
    } else if (tag === "lb_teams") {
      tNpcs.push(npc);
    } else if (tag === "lb_deaths") {
      dNpcs.push(npc);
    }
  }

  return { pNpcs, tNpcs, dNpcs };
}

export function renderBoard() {
  if (system.currentTick - lastRenderTick < RENDER_INTERVAL_TICKS) return;
  lastRenderTick = system.currentTick;

  refreshPlayerCaches();

  const dim = world.getDimension("overworld");

  let npcs;
  try {
    npcs = dim.getEntities({ type: "minecraft:npc" });
  } catch {
    return;
  }

  if (!npcs.length) return;

  const { pNpcs, tNpcs, dNpcs } = collectNpcsByTag(npcs);
  if (!pNpcs.length && !tNpcs.length && !dNpcs.length) return;

  const stats = getStats();

  if (pNpcs.length) {
    updateNpcText(pNpcs, UI.HEAD + getPlayerText(stats) + UI.FOOT);
  }

  if (tNpcs.length) {
    updateNpcText(tNpcs, UI.HEAD + getTeamText() + UI.FOOT);
  }

  if (dNpcs.length) {
    updateNpcText(dNpcs, UI.HEAD + getDeathsText(stats) + UI.FOOT);
  }
}

function updateNpcText(npcs, text) {
  for (let i = 0; i < npcs.length; i++) {
    const npc = npcs[i];
    if (!npc || !npc.isValid) continue;
    if (typeof npc.nameTag !== "string") continue;
    if (npc.nameTag === text) continue;
    npc.nameTag = text;
  }
}

export function spawnLeaderboardNPC() {
  system.runTimeout(spawnLeaderboardNPCNow, 20);
}

function spawnLeaderboardNPCNow() {
  const dim = world.getDimension("overworld");

  for (let i = 0; i < NPCS.length; i++) {
    const cfg = NPCS[i];
    const existing = dim.getEntities({ type: "minecraft:npc", tags: [cfg.tag] });

    for (let j = 0; j < existing.length; j++) {
      const npc = existing[j];
      if (!npc || !npc.isValid) continue;
      npc.remove();
    }

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
}

function queueLeaderboardInteract(player) {
  leaderboardInteractQueue.push(player);
  if (leaderboardInteractScheduled) return;

  leaderboardInteractScheduled = true;
  system.run(drainLeaderboardInteractQueue);
}

function drainLeaderboardInteractQueue() {
  leaderboardInteractScheduled = false;

  while (leaderboardInteractQueue.length > 0) {
    const player = leaderboardInteractQueue.shift();
    if (!player || !player.isValid) continue;
    if (!player.isSneaking) continue;

    renderBoard();
    player.playSound("random.orb", { volume: 0.5, pitch: 1 });
    player.onScreenDisplay.setActionBar("§aLeaderboard Updated!");
  }
}

function handleLeaderboardNpcInteract(ev) {
  const target = ev.target;
  const player = ev.player;

  if (!target) return;
  if (target.typeId !== "minecraft:npc") return;

  if (!target || !target.isValid) return;
  if (getLeaderboardNpcTag(target) === "") return;

  ev.cancel = true;

  if (!player || !player.isValid) return;
  if (!player.hasTag("admin")) {
    system.run(() => {
      player.onScreenDisplay.setActionBar("You don't have permission");
    });
    return;
  }

  queueLeaderboardInteract(player);
}

world.beforeEvents.playerInteractWithEntity.subscribe(handleLeaderboardNpcInteract);
system.run(renderBoard);
