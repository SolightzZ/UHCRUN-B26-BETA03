import { world, system } from "@minecraft/server";

// @ts-ignore
import { getTeamStats, getTeamInfo, getTeamKillObjective, getPlayerStats, getPlayerName } from "../Manager/TeamManager.js";

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

// ======================================================
// isAdmin (ตรวจสอบสิทธิ์ผู้ดูแลระบบ)
// ======================================================
function isAdmin(player) {
  if (!player?.isValid) return false;
  return player.hasTag("admin");
}

// ======================================================
// Get Rank Color (เลือกสีของอันดับตาม index)
// ======================================================
function getRankColor(index) {
  if (index < UI.RANKS.length) return UI.RANKS[index];
  return UI.RANKS[3];
}

// ======================================================
// Get Leaderboard Npc Tag (แปลง tag NPC สำหรับ leaderboard)
// ======================================================
function getLeaderboardNpcTag(entity) {
  if (!entity?.isValid) return "";
  if (entity.hasTag("lb_players")) return "lb_players";
  if (entity.hasTag("lb_teams")) return "lb_teams";
  if (entity.hasTag("lb_deaths")) return "lb_deaths";
  return "";
}

// ======================================================
// Is Leaderboard Npc (ตรวจสอบอันดับ NPC)
// ======================================================
function isLeaderboardNpc(entity) {
  if (!entity?.isValid) return false;
  return getLeaderboardNpcTag(entity) !== "";
}

// ======================================================
// Get Stats (สร้างข้อมูลสถิติของผู้เล่น)
// ======================================================
function getStats() {
  const raw = getPlayerStats();
  const map = new Map();
  if (!raw?.size) return map;

  for (const [id, st] of raw) {
    const kills = st.kills;
    const deaths = st.deaths;
    if (!kills && !deaths) continue;

    let name = id;
    const resolvedName = getPlayerName(id);
    if (resolvedName) {
      name = resolvedName;
    }

    map.set(name, { kills, deaths });
  }

  return map;
}

// ======================================================
// Build Empty Player Text (ข้อความผู้เล่นเมื่อไม่มีข้อมูล)
// ======================================================
function buildEmptyPlayerText() {
  return `§eTop ${MAX_PLAYERS} Players (Kills)\n\n§7... data? ...\n`;
}

// ======================================================
// Get Player Text (แสดงข้อความอันดับผู้เล่นตามจำนวนการฆ่า)
// ======================================================
function getPlayerText(statsMap) {
  const list = [];

  for (const [name, st] of statsMap) {
    if (!st.kills && !st.deaths) continue;

    list.push({ name, st });
    list.sort((a, b) => b.st.kills - a.st.kills);

    if (list.length > MAX_PLAYERS) {
      list.length = MAX_PLAYERS;
    }
  }

  if (!list.length) return buildEmptyPlayerText();

  let text = `§eTop ${MAX_PLAYERS} Players (Kills)\n\n`;
  for (let i = 0; i < list.length; i++) {
    const item = list[i];
    const color = getRankColor(i);
    text += `${color}#${i + 1} §a${item.name} §f- §c${item.st.kills} Kills §8(§4${item.st.deaths} Deaths§8)\n`;
  }

  return text;
}

// ======================================================
// Build Empty Team Text (ข้อความทีมเมื่อไม่มีข้อมูล)
// ======================================================
function buildEmptyTeamText() {
  return `§bTop Team Kills\n\n§7... data? ...\n`;
}

// ======================================================
// Build Team Text (แสดงข้อความทีมจากรายการข้อมูล)
// ======================================================
function buildTeamText(list) {
  if (!list.length) return buildEmptyTeamText();

  let text = `§bTop Team Kills\n\n`;
  for (let i = 0; i < list.length; i++) {
    const color = getRankColor(i);
    text += `${color}#${i + 1} ${list[i].name} §f: §c${list[i].kills} Kills\n`;
  }

  return text;
}

// ======================================================
// Get Objective Team List (สร้างรายการทีมจาก scoreboard)
// ======================================================
function getObjectiveTeamList(obj) {
  const scores = obj.getScores();
  const list = [];
  if (!scores?.length) return list;

  for (let i = 0; i < scores.length; i++) {
    const score = scores[i];
    if (score.score <= 0) continue;

    list.push({
      name: score.participant.displayName,
      kills: score.score,
    });
  }

  list.sort((a, b) => b.kills - a.kills);
  if (list.length > MAX_TEAMS) {
    list.length = MAX_TEAMS;
  }

  return list;
}

// ======================================================
// Get Runtime Team List (สร้างรายการทีมจากสถิติ runtime)
// ======================================================
function getRuntimeTeamList() {
  const tStats = getTeamStats();
  const list = [];
  if (!tStats?.size) return list;

  for (const [id, st] of tStats) {
    if (!st.kills && !st.deaths) continue;

    let name = `§f${id}`;
    const info = getTeamInfo(id);
    if (info) {
      name = `${info.color}${info.name}`;
    }

    list.push({ name, kills: st.kills });
  }

  list.sort((a, b) => b.kills - a.kills);
  if (list.length > MAX_TEAMS) {
    list.length = MAX_TEAMS;
  }

  return list;
}

// ======================================================
// Get Team Text (แสดงข้อความอันดับทีมตามจำนวนการฆ่า)
// ======================================================
function getTeamText() {
  const obj = getTeamKillObjective();
  if (obj) {
    return buildTeamText(getObjectiveTeamList(obj));
  }

  return buildTeamText(getRuntimeTeamList());
}

// ======================================================
// Get Deaths Text (แสดงข้อความผู้เล่นที่ตายมากที่สุด)
// ======================================================
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

// ======================================================
// Collect Npcs By Tag (รวบรวม NPC leaderboard แยกตามกลุ่ม tag)
// ======================================================
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

// ======================================================
// Collect Npcs By Tag (รวบรวม NPC leaderboard แยกตามกลุ่ม tag)
// ======================================================
export function renderBoard() {
  if (system.currentTick - lastRenderTick < RENDER_INTERVAL_TICKS) return;
  lastRenderTick = system.currentTick;

  const dim = world.getDimension("overworld");

  let npcs;
  try {
    npcs = dim.getEntities({ type: "minecraft:npc" });
  } catch {
    return; // @ts-ignore
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

// ======================================================
// Update Npc Text (อัปเดตข้อความ NPC เมื่อมีการเปลี่ยนแปลงเท่านั้น)
// ======================================================
function updateNpcText(npcs, text) {
  for (let i = 0; i < npcs.length; i++) {
    const npc = npcs[i];
    if (!npc?.isValid) continue;
    if (typeof npc.nameTag !== "string") continue;
    if (npc.nameTag === text) continue;
    npc.nameTag = text;
  }
}

// ======================================================
// Spawn Leaderboard NPC (เกิดใหม่ NPC leaderboard ทั้งหมด)
// ======================================================
export function spawnLeaderboardNPC() {
  system.runTimeout(spawnLeaderboardNPCNow, 20);
}

// ======================================================
// Spawn Leaderboard NPC Now (สร้าง NPC leaderboard ทันที)
// ======================================================
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

// ======================================================
// Queue Leaderboard Interact (เพิ่มคิวสำหรับอัปเดตการโต้ตอบ leaderboard แบบเลื่อนเวลา)
// ======================================================
function queueLeaderboardInteract(player) {
  leaderboardInteractQueue.push(player);
  if (leaderboardInteractScheduled) return;

  leaderboardInteractScheduled = true;
  system.run(drainLeaderboardInteractQueue);
}

// ======================================================
// Drain Leaderboard Interact Queue (ประมวลผลคิวอัปเดตการโต้ตอบแบบเลื่อนเวลา)
// ======================================================
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

// ======================================================
// Drain Leaderboard Interact Queue (ประมวลผลคิวอัปเดตการโต้ตอบแบบเลื่อนเวลา)
// ======================================================
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
