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
const MAX_TEAMS = 9;
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

function isAdmin(player) {
  if (!player?.isValid) return false;
  return player.hasTag("admin");
}

function getRankColor(index) {
  if (index < UI.RANKS.length) return UI.RANKS[index];
  return UI.RANKS[3];
}

function getLeaderboardNpcTag(entity) {
  if (!entity?.isValid) return "";
  if (entity.hasTag("lb_players")) return "lb_players";
  if (entity.hasTag("lb_teams")) return "lb_teams";
  if (entity.hasTag("lb_deaths")) return "lb_deaths";
  return "";
}

function isLeaderboardNpc(entity) {
  if (!entity?.isValid) return false;
  return getLeaderboardNpcTag(entity) !== "";
}

function getStats() {
  const objectiveStats = getObjectivePlayerStats();
  if (objectiveStats.size) return objectiveStats;

  const raw = getPlayerStats();
  const map = new Map();
  if (!raw?.size) return map;

  for (const [id, st] of raw) {
    const kills = st?.kills ?? 0;
    const deaths = st?.deaths ?? 0;
    if (!kills && !deaths) continue;

    const name = getPlayerName(id) ?? id;
    const teamInfo = st?.teamId ? getTeamInfo(st.teamId) : null;

    map.set(name, {
      kills,
      deaths,
      teamId: st?.teamId ?? null,
      teamLabel: teamInfo ? `${teamInfo.color}${teamInfo.name}` : null,
    });
  }

  return map;
}

function getObjectivePlayerStats() {
  const obj = getKdHistoryObjective();
  const map = new Map();
  if (!obj) return map;

  const scores = obj.getScores();
  if (!scores?.length) return map;

  for (let i = 0; i < scores.length; i++) {
    const score = scores[i];
    const value = score?.score ?? 0;
    if (value <= 0) continue;

    const key = score?.participant?.displayName;
    if (!key) continue;

    const parts = key.split(" | Victim : ");
    if (parts.length !== 2) continue;

    const killerName = parts[0].replace("Kill: ", "").trim();
    const victimName = parts[1].trim();
    if (!killerName || !victimName) continue;

    const killerEntry = map.get(killerName) ?? { kills: 0, deaths: 0, teamId: null, teamLabel: null };
    killerEntry.kills += value;
    map.set(killerName, killerEntry);

    const victimEntry = map.get(victimName) ?? { kills: 0, deaths: 0, teamId: null, teamLabel: null };
    victimEntry.deaths += value;
    map.set(victimName, victimEntry);
  }

  return map;
}

function buildEmptyPlayerText() {
  return `§eTop ${MAX_PLAYERS} Players (Kills)\n\n§7None (0)\n`;
}

function getPlayerText(statsMap) {
  const list = [];

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
    const teamSuffix = item.st.teamLabel ? ` §8[${item.st.teamLabel}§8]` : "";
    text += `${color}#${i + 1} §a${item.name}${teamSuffix} §f- §c${item.st.kills} Kills §8(§4${item.st.deaths} Deaths§8)\n`;
  }

  return text;
}

function buildEmptyTeamText() {
  return `§bTop Team Kills\n\n§7None (0)\n`;
}

function buildTeamText(list) {
  if (!list.length) return buildEmptyTeamText();

  let text = `§bTop Team Kills\n\n`;
  for (let i = 0; i < list.length; i++) {
    const color = getRankColor(i);
    const members = list[i].members ?? 0;
    text += `${color}#${i + 1} ${list[i].name} §f: §c${list[i].kills} Kills §8(${members} Players)\n`;
  }

  return text;
}

function getObjectiveTeamList(obj) {
  const scores = obj.getScores();
  const teams = getTeams();
  const list = [];
  if (!scores?.length) return list;

  for (let i = 0; i < scores.length; i++) {
    const score = scores[i];
    if (score.score <= 0) continue;

    let matchedTeam = null;
    for (let j = 0; j < teams.length; j++) {
      if (score.participant.displayName.includes(teams[j].name)) {
        matchedTeam = teams[j];
        break;
      }
    }

    list.push({
      name: score.participant.displayName,
      kills: score.score,
      members: matchedTeam ? getPlayersByTeam(matchedTeam.id).length : 0,
      order: matchedTeam ? teams.findIndex((team) => team.id === matchedTeam.id) : Number.MAX_SAFE_INTEGER,
    });
  }

  list.sort((a, b) => b.kills - a.kills || a.order - b.order);
  if (list.length > MAX_TEAMS) list.length = MAX_TEAMS;
  return list;
}

function getRuntimeTeamList() {
  const teams = getTeams();
  const tStats = getTeamStats();
  const list = [];
  if (!teams?.length || !tStats?.size) return list;

  for (let i = 0; i < teams.length; i++) {
    const team = teams[i];
    const st = tStats.get(team.id);
    const members = getPlayersByTeam(team.id).length;
    if (!st?.kills && !st?.deaths && members <= 0) continue;

    list.push({
      name: `${team.color}${team.name}`,
      kills: st?.kills ?? 0,
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

function getDeathsText(statsMap) {
  let topName = "None";
  let max = 0;

  for (const [name, st] of statsMap) {
    if (st.deaths <= max) continue;
    max = st.deaths;
    topName = name;
  }

  return `§cTop Deaths: §7${topName} (${max})§r\n`;
}

function collectNpcsByTag(npcs) {
  const pNpcs = [];
  const tNpcs = [];
  const dNpcs = [];

  for (let i = 0; i < npcs.length; i++) {
    const npc = npcs[i];
    if (!npc?.isValid) continue;

    switch (getLeaderboardNpcTag(npc)) {
      case "lb_players":
        pNpcs.push(npc);
        break;
      case "lb_teams":
        tNpcs.push(npc);
        break;
      case "lb_deaths":
        dNpcs.push(npc);
        break;
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
    if (!npc?.isValid) continue;
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
      if (!npc?.isValid) continue;
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
    if (!player?.isValid) continue;
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
  if (!isLeaderboardNpc(target)) return;

  ev.cancel = true;

  if (!isAdmin(player)) {
    player.onScreenDisplay.setActionBar("You don't have permission");
    return;
  }

  queueLeaderboardInteract(player);
}

world.beforeEvents.playerInteractWithEntity.subscribe(handleLeaderboardNpcInteract);
system.run(renderBoard);
