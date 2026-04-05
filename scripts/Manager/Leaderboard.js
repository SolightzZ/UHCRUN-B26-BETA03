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

const MAX_PLAYERS = 10; // จำนวนผู้เล่นสูงสุดที่แสดงในตารางคะแนน
const MAX_TEAMS = 10; // จำนวนทีมสูงสุดที่แสดงในตารางคะแนน

// รูปแบบการแสดงผล
const UI = Object.freeze({
  HEAD: "§g§l--- [ UHCRUN LEADERBOARD ] ---\n\n",
  FOOT: "\n§g-----------------------------------",
  RANKS: ["§6", "§7", "§c", "§f"],
});

// ตำแหน่งของ NPC แต่ละตัว (ไม่ใช้ tag แล้ว)
const NPCS = Object.freeze([
  { x: 596.5, y: 127, z: 601.5 }, // index 0 = Top Team Kill
  { x: 593.5, y: 127, z: 600.5 }, // index 1 = Top Player Kill
  { x: 599.5, y: 127, z: 600.5 }, // index 2 = Top Player Deaths
]);

// การแคชเอนทิตีและการจดจำค่า
const NPC_QUERY_OPTIONS = Object.freeze({
  type: "minecraft:npc",
  location: { x: 596, y: 127, z: 600 },
  maxDistance: 10,
});

let lastStatsHash = "";
let lastTeamHash = "";
let cachedPlayerText = "";
let cachedTeamText = "";
let cachedDeathsText = "";

// ฟังก์ชันสำหรับบังคับรีเฟรชข้อมูลทีม
function forceRefreshTeamData() {
  console.warn("[DEBUG] forceRefreshTeamData - Clearing cache");
  lastTeamHash = "";
  cachedTeamText = "";
  lastStatsHash = "";
  cachedPlayerText = "";
  cachedDeathsText = "";
}

// ฟังก์ชันสำหรับแสดงทีมทั้งหมดแม้ไม่มี kill
function getAllTeamsForDisplay() {
  console.warn("[DEBUG] getAllTeamsForDisplay - Getting all teams regardless of kills");
  
  const allTeams = getTeams();
  const teamList = [];
  
  if (!allTeams || !allTeams.length) {
    console.warn("[DEBUG] getAllTeamsForDisplay - No teams found in system");
    return teamList;
  }

  for (let i = 0; i < allTeams.length; i++) {
    const teamInfo = allTeams[i];
    const memberCount = getPlayersByTeam(teamInfo.id).length;
    
    // แสดงทีมทั้งหมดแม้ไม่มี kill
    const teamData = {
      name: teamInfo.color + teamInfo.name,
      kills: 0, // เริ่มต้นด้วย 0
      members: memberCount,
      order: i,
    };
    
    console.warn(`[DEBUG] getAllTeamsForDisplay - Team ${i}: "${teamData.name}" members=${memberCount}`);
    teamList.push(teamData);
  }

  // เรียงตามลำดับทีม
  teamList.sort((a, b) => a.order - b.order);

  if (teamList.length > MAX_TEAMS) {
    teamList.length = MAX_TEAMS;
  }
  
  console.warn("[DEBUG] getAllTeamsForDisplay - Returning", teamList.length, "teams");
  return teamList;
}
// getRankColor (คืนค่าสีตามอันดับที่กำหนด)
// ======================================================
function getRankColor(index) {
  if (index < UI.RANKS.length) {
    return UI.RANKS[index];
  } else {
    return UI.RANKS[3];
  }
}

// ======================================================
// generateStatsHash (สร้างรหัสตรวจสอบการเปลี่ยนแปลงของข้อมูลสถิติ)
// ======================================================
function generateStatsHash(statsMap) {
  const entries = Array.from(statsMap.entries());
  let hashString = "";
  for (let i = 0; i < entries.length; i++) {
    const [name, stats] = entries[i];
    hashString += `${name}${stats.kills}${stats.deaths}${stats.teamLabel || ""}`;
  }
  return hashString;
}

// ======================================================
//
//        DATA PROCESSING - การประมวลผลข้อมูล
//
// ======================================================
// getStats (รวบรวมข้อมูลสถิติผู้เล่นจาก Scoreboard หรือ Cache)
// ======================================================
function getStats() {
  console.warn("[DEBUG] getStats() called");

  const objectivePlayerStats = getObjectivePlayerStats();
  console.warn("[DEBUG] objectivePlayerStats size:", objectivePlayerStats.size);
  if (objectivePlayerStats.size) return objectivePlayerStats;

  const rawPlayerStats = getPlayerStats();
  console.warn("[DEBUG] rawPlayerStats:", rawPlayerStats ? rawPlayerStats.size : "null/undefined");
  const playerStatsMap = new Map();
  if (!rawPlayerStats || !rawPlayerStats.size) {
    console.warn("[DEBUG] No rawPlayerStats found, returning empty map");
    return playerStatsMap;
  }

  const playerEntries = Array.from(rawPlayerStats.entries());
  for (let i = 0; i < playerEntries.length; i++) {
    const playerId = playerEntries[i][0];
    const playerStats = playerEntries[i][1];

    let killCount;
    if (playerStats && playerStats.kills !== undefined) {
      killCount = playerStats.kills;
    } else {
      killCount = 0;
    }

    let deathCount;
    if (playerStats && playerStats.deaths !== undefined) {
      deathCount = playerStats.deaths;
    } else {
      deathCount = 0;
    }

    if (!killCount && !deathCount) continue;

    let playerName;
    if (getPlayerName(playerId)) {
      playerName = getPlayerName(playerId);
    } else {
      playerName = playerId;
    }

    let teamInfo;
    if (playerStats && playerStats.teamId) {
      teamInfo = getTeamInfo(playerStats.teamId);
    } else {
      teamInfo = null;
    }

    let teamId;
    if (playerStats && playerStats.teamId !== undefined) {
      teamId = playerStats.teamId;
    } else {
      teamId = null;
    }

    let teamLabel;
    if (teamInfo) {
      teamLabel = teamInfo.color + teamInfo.name;
    } else {
      teamLabel = null;
    }

    playerStatsMap.set(playerName, {
      kills: killCount,
      deaths: deathCount,
      teamId,
      teamLabel,
    });
  }

  return playerStatsMap;
}

// ======================================================
// processScoreEntry (ประมวลผลคะแนนดิบจากข้อมูลประวัติการฆ่า)
// ======================================================
function processScoreEntry(scoreEntry, playerStatsMap) {
  let scoreValue;
  if (scoreEntry && scoreEntry.score !== undefined) {
    scoreValue = scoreEntry.score;
  } else {
    scoreValue = 0;
  }

  if (scoreValue <= 0) return;

  let displayName;
  if (scoreEntry && scoreEntry.participant && scoreEntry.participant.displayName) {
    displayName = scoreEntry.participant.displayName;
  } else {
    return;
  }

  const nameParts = displayName.split(" | Victim : ");
  if (nameParts.length !== 2) return;

  const killerName = nameParts[0].replace("Kill: ", "").trim();
  const victimName = nameParts[1].trim();
  if (!killerName || !victimName) return;

  let killerStats;
  if (playerStatsMap.has(killerName)) {
    killerStats = playerStatsMap.get(killerName);
  } else {
    killerStats = { kills: 0, deaths: 0, teamId: null, teamLabel: null };
  }
  killerStats.kills += scoreValue;
  playerStatsMap.set(killerName, killerStats);

  let victimStats;
  if (playerStatsMap.has(victimName)) {
    victimStats = playerStatsMap.get(victimName);
  } else {
    victimStats = { kills: 0, deaths: 0, teamId: null, teamLabel: null };
  }
  victimStats.deaths += scoreValue;
  playerStatsMap.set(victimName, victimStats);
}

// ======================================================
// getObjectivePlayerStats (ดึงสถิติผู้เล่นจากระบบ Scoreboard Objective)
// ======================================================
function getObjectivePlayerStats() {
  console.warn("[DEBUG] getObjectivePlayerStats() called");

  const kdHistoryObjective = getKdHistoryObjective();
  console.warn("[DEBUG] kdHistoryObjective:", kdHistoryObjective ? "exists" : "null/undefined");

  const playerStatsMap = new Map();
  if (!kdHistoryObjective) {
    console.warn("[DEBUG] No kdHistoryObjective found");
    return playerStatsMap;
  }

  const objectiveScores = kdHistoryObjective.getScores();
  console.warn("[DEBUG] objectiveScores length:", objectiveScores ? objectiveScores.length : "null/undefined");
  if (!objectiveScores || !objectiveScores.length) {
    console.warn("[DEBUG] No objectiveScores found");
    return playerStatsMap;
  }

  for (let i = 0; i < objectiveScores.length; i++) {
    processScoreEntry(objectiveScores[i], playerStatsMap);
  }

  return playerStatsMap;
}

// ======================================================
//
//      TEXT BUILDERS - ฟังก์ชันสร้างข้อความแสดงผล
//
// ======================================================
// buildEmptyPlayerText (สร้างข้อความกรณีไม่มีข้อมูลผู้เล่นในตาราง)
// ======================================================
function buildEmptyPlayerText() {
  return `§eTop ${MAX_PLAYERS} Players (Kills)\n\n§7None (0)\n`;
}

// ======================================================
// getPlayerText (จัดรูปแบบข้อความตารางคะแนนผู้เล่น (รองรับ Memoization))
// ======================================================
function getPlayerText(playerStatsMap) {
  // ตรวจสอบดูว่าเราสามารถใช้ผลลัพธ์ที่แคชไว้ได้หรือไม่
  const currentHash = generateStatsHash(playerStatsMap);
  if (currentHash === lastStatsHash && cachedPlayerText) {
    return cachedPlayerText;
  }

  const playerList = [];

  // สร้างรายชื่อผู้เล่นพร้อมจำนวนการสังหาร/การตาย
  const statsEntries = Array.from(playerStatsMap.entries());
  for (let i = 0; i < statsEntries.length; i++) {
    const playerName = statsEntries[i][0];
    const playerStats = statsEntries[i][1];
    if (!playerStats.kills && !playerStats.deaths) continue;
    playerList.push({ name: playerName, st: playerStats });
  }

  playerList.sort((a, b) => {
    if (b.st.kills !== a.st.kills) {
      return b.st.kills - a.st.kills;
    } else {
      return a.name.localeCompare(b.name);
    }
  });

  if (playerList.length > MAX_PLAYERS) {
    playerList.length = MAX_PLAYERS;
  }

  if (!playerList.length) {
    cachedPlayerText = buildEmptyPlayerText();
    lastStatsHash = currentHash;
    return cachedPlayerText;
  }

  let leaderboardText = `§eTop ${MAX_PLAYERS} Players (Kills)\n\n`;
  for (let i = 0; i < playerList.length; i++) {
    const playerItem = playerList[i];
    const rankColor = getRankColor(i);

    let teamSuffix;
    if (playerItem.st.teamLabel) {
      teamSuffix = ` §8[${playerItem.st.teamLabel}§8]`;
    } else {
      teamSuffix = "";
    }

    leaderboardText += `${rankColor}#${i + 1} §a${playerItem.name}${teamSuffix} §f- §c${playerItem.st.kills} Kills §8(§4${playerItem.st.deaths} Deaths§8)\n`;
  }

  // บันทึกผลลัพธ์ลงในแคช
  cachedPlayerText = leaderboardText;
  lastStatsHash = currentHash;
  return leaderboardText;
}

// ======================================================
// buildEmptyTeamText (สร้างข้อความกรณีไม่มีข้อมูลทีมในตาราง)
// ======================================================
function buildEmptyTeamText() {
  console.warn("[DEBUG] buildEmptyTeamText - Showing fallback message");
  return `§bTop ${MAX_TEAMS} Teams (Kills)\n\n§7No team data available\n§7Check if teams are created and players are assigned\n`;
}

// ======================================================
// buildTeamText (จัดรูปแบบข้อความตารางคะแนนทีม)
// ======================================================
function buildTeamText(teamList) {
  console.warn("[DEBUG] buildTeamText - Input team list:", teamList);
  
  if (!teamList || !teamList.length) {
    console.warn("[DEBUG] buildTeamText - No teams, returning empty text");
    return buildEmptyTeamText();
  }

  let teamLeaderboardText = `§bTop ${MAX_TEAMS} Teams (Kills)\n\n`;
  
  for (let i = 0; i < teamList.length; i++) {
    const team = teamList[i];
    console.warn(`[DEBUG] buildTeamText - Team ${i + 1}: "${team.name}" kills=${team.kills} members=${team.members}`);
    
    const rankColor = getRankColor(i);

    let memberCount;
    if (team.members !== undefined) {
      memberCount = team.members;
    } else {
      memberCount = 0;
    }

    teamLeaderboardText += `${rankColor}#${i + 1} ${team.name} §f: §c${team.kills} Kills §7(${memberCount} Players)\n`;
  }

  console.warn("[DEBUG] buildTeamText - Final text length:", teamLeaderboardText.length);
  return teamLeaderboardText;
}

// ======================================================
//
//       TEAM DATA PROCESSING - การประมวลผลข้อมูลทีม
//
// ======================================================
// getObjectiveTeamList (ดึงและจัดลำดับคะแนนทีมจาก Scoreboard Objective)
// ======================================================
function getObjectiveTeamList(teamKillObjective) {
  const objectiveScores = teamKillObjective.getScores();
  const allTeams = getTeams();
  const teamList = [];

  let scoresLength;
  if (objectiveScores) {
    scoresLength = objectiveScores.length;
  } else {
    scoresLength = 0;
  }
  console.warn("[DEBUG] getObjectiveTeamList - scores length:", scoresLength);

  if (!objectiveScores || !objectiveScores.length) return teamList;

  // สร้างแผนที่ค้นหาทีมสำหรับการเข้าถึง
  const teamMap = new Map();
  for (let i = 0; i < allTeams.length; i++) {
    const team = allTeams[i];
    const teamLabel = team.color + team.name;
    teamMap.set(teamLabel, { team, index: i });
  }

  for (let i = 0; i < objectiveScores.length; i++) {
    const scoreEntry = objectiveScores[i];
    let teamDisplayName;
    if (scoreEntry && scoreEntry.participant && scoreEntry.participant.displayName) {
      teamDisplayName = scoreEntry.participant.displayName;
    } else {
      continue;
    }

    const teamScoreValue = scoreEntry.score;

    console.warn('[DEBUG] Score: "' + teamDisplayName + '" = ' + teamScoreValue);

    if (teamScoreValue <= 0) continue;

    // การค้นหาทีม
    const teamData = teamMap.get(teamDisplayName);
    if (!teamData) {
      console.warn('[DEBUG] No team matched for displayName: "' + teamDisplayName + '"');
      continue;
    }

    teamList.push({
      name: teamDisplayName,
      kills: teamScoreValue,
      members: getPlayersByTeam(teamData.team.id).length,
      order: teamData.index,
    });
  }

  console.warn("[DEBUG] Final objective list:", teamList.length, teamList);

  teamList.sort((a, b) => {
    if (b.kills !== a.kills) {
      return b.kills - a.kills;
    } else {
      return a.order - b.order;
    }
  });

  if (teamList.length > MAX_TEAMS) {
    teamList.length = MAX_TEAMS;
  }
  return teamList;
}

// ======================================================
// getRuntimeTeamList (ดึงข้อมูลทีมจากหน่วยความจำกรณีไม่มี Scoreboard)
// ======================================================
function getRuntimeTeamList() {
  console.warn("[DEBUG] getRuntimeTeamList - Starting");
  
  const allTeams = getTeams();
  const teamStatsMap = getTeamStats();
  const teamList = [];
  
  console.warn("[DEBUG] getRuntimeTeamList - All teams count:", allTeams ? allTeams.length : 0);
  console.warn("[DEBUG] getRuntimeTeamList - Team stats map size:", teamStatsMap ? teamStatsMap.size : 0);
  
  if (!allTeams || !allTeams.length) {
    console.warn("[DEBUG] getRuntimeTeamList - No teams found");
    return teamList;
  }

  let hasAnyKills = false;

  for (let i = 0; i < allTeams.length; i++) {
    const teamInfo = allTeams[i];

    let teamStats;
    if (teamStatsMap && teamStatsMap.size) {
      teamStats = teamStatsMap.get(teamInfo.id);
    } else {
      teamStats = null;
    }

    const memberCount = getPlayersByTeam(teamInfo.id).length;

    let killCount;
    if (teamStats && teamStats.kills !== undefined) {
      killCount = teamStats.kills;
      if (killCount > 0) hasAnyKills = true;
    } else {
      killCount = 0;
    }

    const teamData = {
      name: teamInfo.color + teamInfo.name,
      kills: killCount,
      members: memberCount,
      order: i,
    };
    
    console.warn(`[DEBUG] getRuntimeTeamList - Team ${i}: "${teamData.name}" kills=${killCount} members=${memberCount}`);
    teamList.push(teamData);
  }

  // ถ้าไม่มีทีมไหนมี kill เลย ให้แสดงทีมทั้งหมดแบบเรียงตามลำดับ
  if (!hasAnyKills) {
    console.warn("[DEBUG] getRuntimeTeamList - No kills found, showing all teams by order");
    teamList.sort((a, b) => a.order - b.order);
  } else {
    // เรียงตามจำนวน kill
    teamList.sort((a, b) => {
      if (b.kills !== a.kills) {
        return b.kills - a.kills;
      } else {
        return a.order - b.order;
      }
    });
  }

  if (teamList.length > MAX_TEAMS) {
    teamList.length = MAX_TEAMS;
  }
  
  console.warn("[DEBUG] getRuntimeTeamList - Final sorted list length:", teamList.length);
  return teamList;
}

// ======================================================
// getTeamText (เลือกดึงข้อมูลทีมจากช่องทางที่เหมาะสมที่สุด พร้อม Caching)
// ======================================================
function getTeamText() {
  const teamKillObjective = getTeamKillObjective();
  let teamList = [];

  console.warn("[DEBUG] getTeamText - teamKillObjective exists:", !!teamKillObjective);

  if (teamKillObjective) {
    const objectiveTeamList = getObjectiveTeamList(teamKillObjective);
    console.warn("[DEBUG] getTeamText - objectiveTeamList length:", objectiveTeamList.length);
    
    if (objectiveTeamList.length) {
      teamList = objectiveTeamList;
      console.warn("[DEBUG] getTeamText - Using objective team list");
    } else {
      console.warn("[DEBUG] getTeamText - Objective has no data, falling back to runtime list");
      teamList = getRuntimeTeamList();
    }
  } else {
    console.warn("[DEBUG] getTeamText - No objective found, using runtime list");
    teamList = getRuntimeTeamList();
  }

  // สร้าง hash สำหรับ team data เพื่อตรวจสอบการเปลี่ยนแปลง
  let teamHash = "";
  for (let i = 0; i < teamList.length; i++) {
    const team = teamList[i];
    teamHash += `${team.name}${team.kills}${team.members}${team.order}`;
  }

  console.warn("[DEBUG] getTeamText - Final team list length:", teamList.length);
  console.warn("[DEBUG] getTeamText - Team hash:", teamHash);

  // ตรวจสอบว่าข้อมูลเปลี่ยนแปลงหรือไม่
  if (teamHash === lastTeamHash && cachedTeamText) {
    console.warn("[DEBUG] getTeamText - Using cached text");
    return cachedTeamText;
  }

  // สร้างข้อความใหม่และเก็บใน cache
  cachedTeamText = buildTeamText(teamList);
  lastTeamHash = teamHash;

  console.warn("[DEBUG] getTeamText - Generated new text, length:", cachedTeamText.length);
  return cachedTeamText;
}

// ======================================================
//
// DEATHS LEADERBOARD - ตารางคะแนนการตาย
//
// ======================================================
// buildEmptyDeathsText (สร้างข้อความกรณีไม่มีข้อมูลการตายในตาราง)
// ======================================================
function buildEmptyDeathsText() {
  return `§cTop ${MAX_PLAYERS} Deaths\n\n§7None (0)\n`;
}

// ======================================================
// getDeathsText (จัดรูปแบบข้อความตารางคะแนนการตาย (รองรับ Memoization))
// ======================================================
function getDeathsText(playerStatsMap) {
  // ตรวจสอบดูว่าเราสามารถใช้ผลลัพธ์ที่แคชไว้ได้หรือไม่
  const currentHash = generateStatsHash(playerStatsMap);
  if (currentHash === lastStatsHash && cachedDeathsText) {
    return cachedDeathsText;
  }

  const deathsList = [];

  const statsEntries = Array.from(playerStatsMap.entries());
  for (let i = 0; i < statsEntries.length; i++) {
    const playerName = statsEntries[i][0];
    const playerStats = statsEntries[i][1];
    if (!playerStats.deaths) continue;
    deathsList.push({ name: playerName, st: playerStats });
  }

  deathsList.sort((a, b) => {
    if (b.st.deaths !== a.st.deaths) {
      return b.st.deaths - a.st.deaths;
    } else {
      return a.name.localeCompare(b.name);
    }
  });

  if (deathsList.length > MAX_PLAYERS) {
    deathsList.length = MAX_PLAYERS;
  }

  if (!deathsList.length) {
    cachedDeathsText = buildEmptyDeathsText();
    return cachedDeathsText;
  }

  let deathsLeaderboardText = `§cTop ${MAX_PLAYERS} Deaths\n\n`;
  for (let i = 0; i < deathsList.length; i++) {
    const playerItem = deathsList[i];
    const rankColor = getRankColor(i);

    let teamSuffix;
    if (playerItem.st.teamLabel) {
      teamSuffix = ` §8[${playerItem.st.teamLabel}§8]`;
    } else {
      teamSuffix = "";
    }

    deathsLeaderboardText += `${rankColor}#${i + 1} §a${playerItem.name}${teamSuffix} §f- §4${playerItem.st.deaths} Deaths §8(§c${playerItem.st.kills} Kills§8)\n`;
  }

  // บันทึกผลลัพธ์ลงในแคช
  cachedDeathsText = deathsLeaderboardText;
  return deathsLeaderboardText;
}

// ======================================================
//
//          NPC MANAGEMENT - การจัดการ NPC
//
// ======================================================
// collectNpcsByTag (แยกกลุ่ม NPC ตามลำดับ index)
// ======================================================
function collectNpcsByTag(allNpcs) {
  const teamNpcs = []; // index 0 = Top Team Kill
  const playerNpcs = []; // index 1 = Top Player Kill
  const deathNpcs = []; // index 2 = Top Player Deaths

  console.warn("[DEBUG] Collecting NPCs by index from", allNpcs.length, "total NPCs");

  for (let i = 0; i < allNpcs.length && i < 3; i++) {
    const npcEntity = allNpcs[i];
    if (!npcEntity || !npcEntity.isValid) continue;

    // กำหนด NPC ตามลำดับ index
    if (i === 0) {
      teamNpcs.push(npcEntity);
      console.warn("[DEBUG] NPC", i, "assigned to Teams leaderboard");
    } else if (i === 1) {
      playerNpcs.push(npcEntity);
      console.warn("[DEBUG] NPC", i, "assigned to Players leaderboard");
    } else if (i === 2) {
      deathNpcs.push(npcEntity);
      console.warn("[DEBUG] NPC", i, "assigned to Deaths leaderboard");
    }
  }

  console.warn("[DEBUG] Collected NPCs - Teams:", teamNpcs.length, "Players:", playerNpcs.length, "Deaths:", deathNpcs.length);
  return { pNpcs: playerNpcs, tNpcs: teamNpcs, dNpcs: deathNpcs };
}

// ======================================================
//
//          RENDERING SYSTEM - ระบบการแสดงผล
//
// ======================================================
// renderBoard (ฟังก์ชันหลักในการอัปเดตข้อความบน NPC ทั้งหมด)
// ======================================================
export function renderBoard() {
  console.warn("[DEBUG] renderBoard() called");

  refreshPlayerCaches();

  // ค้นหา NPCs ใหม่ทุกครั้ง
  const overworldDimension = world.getDimension("overworld");
  let allNpcs = [];

  try {
    allNpcs = overworldDimension.getEntities(NPC_QUERY_OPTIONS);
    console.warn("[DEBUG] Found NPCs:", allNpcs.length);
  } catch (error) {
    console.warn("[DEBUG] Error getting NPCs:", error);
    return;
  }

  if (!allNpcs.length) {
    console.warn("[DEBUG] No NPCs found, exiting renderBoard");
    return;
  }

  const { pNpcs: playerNpcs, tNpcs: teamNpcs, dNpcs: deathNpcs } = collectNpcsByTag(allNpcs);
  console.warn("[DEBUG] NPC counts - Teams:", teamNpcs.length, "Players:", playerNpcs.length, "Deaths:", deathNpcs.length);

  if (!teamNpcs.length && !playerNpcs.length && !deathNpcs.length) {
    console.warn("[DEBUG] No leaderboard NPCs found with proper tags");
    return;
  }

  const playerStats = getStats();
  console.warn("[DEBUG] Final playerStats size:", playerStats.size);

  if (teamNpcs.length) {
    const teamText = getTeamText();
    console.warn("[DEBUG] Team text generated:", `${teamText.substring(0, 100)}...`);
    updateNpcText(teamNpcs, `${UI.HEAD}${teamText}${UI.FOOT}`);
  }

  if (playerNpcs.length) {
    const playerText = getPlayerText(playerStats);
    console.warn("[DEBUG] Player text generated:", `${playerText.substring(0, 100)}...`);
    updateNpcText(playerNpcs, `${UI.HEAD}${playerText}${UI.FOOT}`);
  }

  if (deathNpcs.length) {
    const deathsText = getDeathsText(playerStats);
    console.warn("[DEBUG] Deaths text generated:", `${deathsText.substring(0, 100)}...`);
    updateNpcText(deathNpcs, `${UI.HEAD}${deathsText}${UI.FOOT}`);
  }
}

// ======================================================
// updateNpcText (ตรวจสอบและอัปเดต nameTag ของ NPC เฉพาะเมื่อมีการเปลี่ยนแปลง)
// ======================================================
function updateNpcText(npcList, displayText) {
  for (let i = 0; i < npcList.length; i++) {
    const npcEntity = npcList[i];
    if (!npcEntity || !npcEntity.isValid) continue;
    if (typeof npcEntity.nameTag !== "string") continue;
    if (npcEntity.nameTag === displayText) continue;
    npcEntity.nameTag = displayText;
  }
}

// ======================================================
// spawnLeaderboardNPCNow (สร้าง NPC ตารางคะแนนในตำแหน่งที่กำหนดหากยังไม่มี)
// ======================================================
function spawnLeaderboardNPCNow() {
  const overworldDimension = world.getDimension("overworld");

  // ลบ NPC เก่าทั้งหมดในพื้นที่
  const existingNpcs = overworldDimension.getEntities(NPC_QUERY_OPTIONS);
  console.warn("[DEBUG] Removing existing NPCs:", existingNpcs.length);

  for (let i = 0; i < existingNpcs.length; i++) {
    existingNpcs[i].remove();
  }

  // สร้าง NPC ใหม่ทั้งหมด
  for (let i = 0; i < NPCS.length; i++) {
    const npcConfig = NPCS[i];

    try {
      const newNpcEntity = overworldDimension.spawnEntity("minecraft:npc", {
        x: npcConfig.x,
        y: npcConfig.y,
        z: npcConfig.z,
      });

      // ตั้งชื่อ NPC ตาม index
      if (i === 0) {
        newNpcEntity.nameTag = "§b§lTOP TEAMS (KILLS)";
      } else if (i === 1) {
        newNpcEntity.nameTag = "§e§lTOP PLAYERS (KILLS)";
      } else if (i === 2) {
        newNpcEntity.nameTag = "§c§lTOP PLAYERS (DEATHS)";
      }

      console.warn("[Leaderboard] Spawned new NPC at index:", i);
    } catch (error) {
      console.warn("[Leaderboard] Failed to spawn NPC at:", npcConfig.x, npcConfig.y, npcConfig.z, error);
    }
  }

  // บังคับอัปเดตข้อมูลลีดเดอร์บอร์ดหลังจากสร้างเสร็จ
  updateLeaderboard();
}

// ======================================================
// updateLeaderboard (รีเซ็ตแคชและบังคับอัปเดตข้อมูลตารางคะแนนทันที)
// ======================================================
export function updateLeaderboard() {
  system.runTimeout(() => {
    lastStatsHash = "";
    lastTeamHash = "";
    cachedPlayerText = "";
    cachedTeamText = "";
    cachedDeathsText = "";

    refreshPlayerCaches();
    renderBoard();
    console.warn("[Leaderboard] Auto updated");
  }, 40);
}

// ======================================================
// spawnLeaderboardNPC (หน่วงเวลาการสร้าง NPC เพื่อรอให้พื้นโหลดสำเร็จ)
// ======================================================
export function spawnLeaderboardNPC() {
  system.runTimeout(spawnLeaderboardNPCNow, 20);
}

// Export ฟังก์ชันสำหรับการ debug และรีเฟรช
export { forceRefreshTeamData, getAllTeamsForDisplay };

system.run(renderBoard);

// ======================================================
// EVENT HANDLERS - ป้องกันการเปิด NPC Dialog
// ======================================================
world.beforeEvents.playerInteractWithEntity.subscribe((eventData) => {
  const { target } = eventData;
  if (target.typeId === "minecraft:npc") {
    eventData.cancel = true;
  }
});
