import { DisplaySlotId, EntityDamageCause, MolangVariableMap, ObjectiveSortOrder, world } from "@minecraft/server";

// @ts-ignore
import { getAllPlayers, getPlayerTeam, getTeams, getUhcPlayers } from "../Manager/TeamManager.js";
// @ts-ignore
import { dynamicToast } from "../plugin/Util.js";
// @ts-ignore
import { fillHasPendingWork, getEndSequenceLabel, getEndSequenceStep, shouldAdvanceEndSequence, END_SEQUENCE_STATE } from "./BlockFiller.js";

// ชุดไอคอนสำหรับใช้แสดงผลในข้อความและ scoreboard
export const icons = Object.freeze({
  Sword: "",
  Bow: "",
  shield: "",
  Helmet: "",
  Border: "",
  Mojang: "",
  Bot: "",
  Sailboat: "",
  FourGrid: "",
  Corners: "",
  Diagonal: "",
  Burst: "",
  Clock: "",
  Square: "",
  Bars: "",
  Frame: "",
  Hourglass: "",
});

// รหัสสีข้อความของ Minecraft สำหรับประกอบ UI
export const MinecraftColor = Object.freeze({
  black: "§0",
  darkBlue: "§1",
  darkGreen: "§2",
  darkAqua: "§3",
  darkRed: "§4",
  darkPurple: "§5",
  gold: "§6",
  gray: "§7",
  darkGray: "§8",
  blue: "§9",
  green: "§a",
  aqua: "§b",
  red: "§c",
  lightPurple: "§d",
  yellow: "§e",
  white: "§f",
  minecoinGold: "§g",
  h: "§h",
  n: "§n",
});

let TEAMS = [];
// ดึงทีมแบบ cache เพื่อลดการเรียกข้อมูลซ้ำ
function getTeamsCached() {
  if (!TEAMS.length) TEAMS = getTeams();
  return TEAMS;
}

// ลำดับรัศมีของ border ที่จะหดลงตามช่วงเกม
export const CHECKPOINTS = [500, 450, 400, 350, 300, 250, 200, 150, 100, 80, 50, 25, 16, 10, 5, 2];

// ค่ารัศมีสุดท้ายของ border
export const borderEnd = CHECKPOINTS[CHECKPOINTS.length - 1];

// ค่าคงที่สำหรับการเรนเดอร์ particle ของ border
const BORDER_RENDER = Object.freeze({
  VIEW_DISTANCE: 35,
  PARTICLE_Y: 100,
});

// ชุดสีของ border แยกตามสถานะปกติและตอนกำลังหด
export const borderColors = {
  blue: { red: 0, green: 0.54, blue: 1, alpha: 1.0 },
  red: { red: 1.0, green: 0.2, blue: 0.2, alpha: 1.0 },
};

// ค่าเวลาแสดงผล title บนหน้าจอผู้เล่น
const titleConfig = Object.freeze({ stayDuration: 200, fadeInDuration: 10, fadeOutDuration: 20 });

// ค่าเริ่มต้นของเสียงที่ใช้ตอน broadcast
const soundConfig = Object.freeze({ volume: 0.8, pitch: 1 });

// ชื่อ particle สำหรับเรนเดอร์ border ตามแต่ละแกน
const worldborder_ew = "worldborder:worldborder_ew";
const worldborder = "worldborder:worldborder";

// ชื่อ objective ของ scoreboard
const uhc = "uhc";

// ชื่อแสดงผลของ objective พร้อมสี
const uhcName = MinecraftColor.h + MinecraftColor.n + "UhcRun26";

// จำนวน tick ต่อวินาทีของเกม
export const ticks = 20;
// จุดศูนย์กลางของ border
export const center = { x: 0, z: 0 };

// สร้าง state กลางของระบบ border และ UI
export function GameContext() {
  return {
    isRunning: false,
    uhcTick: 0,
    checkInterval: null,
    cachedDimension: null,
    fillCommandLocked: false,
    prevShowCoordinates: false,
    borderReady: false,
    borderRadius: CHECKPOINTS[0],
    nextShrinkIndex: 1,
    nextShrinkTick: 300,
    targetRadius: null,
    wbBounds: null,
    shrinkStartTick: 0,
    shrinkDuration: 0,
    startRadius: CHECKPOINTS[0],
    currentBorderColor: borderColors.blue,
    endSeqState: 0,
    endSeqStartTick: -1,
    objective: null,
    aliveTeamBarCache: MinecraftColor.gray + "-",
    aliveTeamDirty: true,
    lastBorderRadius: -1,
    lastPlayerCount: -1,
    lastTargetRadius: null,
    borderMolang: null,
  };
}

// รีเซ็ต context เป้าหมายกลับเป็นค่าเริ่มต้นทั้งหมด
export function resetContext(target) {
  const fresh = GameContext();
  const keys = Object.keys(fresh);
  for (let i = 0; i < keys.length; i++) target[keys[i]] = fresh[keys[i]];
}

// context กลางที่ใช้ร่วมกันภายในโมดูลนี้
export const ctx = GameContext();

// cache ข้อความแต่ละบรรทัดของ scoreboard
const scoreCache = new Map();

// object สำหรับ title options ที่นำกลับมาใช้ซ้ำ
const reusableTitleOptions = {
  stayDuration: titleConfig.stayDuration,
  fadeInDuration: titleConfig.fadeInDuration,
  fadeOutDuration: titleConfig.fadeOutDuration,
  subtitle: "",
};

// กำหนดเวลาหดและเวลาพักของ border ในแต่ละช่วงรัศมี
const SHRINK_CONFIG = [
  [200, 80, 90],
  [100, 60, 60],
  [50, 50, 45],
  [16, 40, 30],
  [5, 30, 20],
  [0, 20, 15],
];

// เก็บกลุ่มผู้เล่นสำหรับ render particle
const groupMaps = new Map();
// pool สำหรับ reuse กลุ่ม ลดการสร้าง object ใหม่
const groupsPool = [];
// track particle ที่ spawn ใน tick นี้
const spawnedThisTick = new Set();
// ตำแหน่งกลางที่ใช้ร่วมกัน (ลดการสร้าง object)
const sharedPos = { x: 0, y: BORDER_RENDER.PARTICLE_Y, z: 0 };
// object ตำแหน่งสำหรับ particle (reuse)
const particleLocPool = { x: 0, y: 0, z: 0 };

let groupsLen = 0;
// จำนวนกลุ่มผู้เล่นสูงสุดที่เก็บไว้ต่อ tick
const GROUPS_POOL_CAP = 64;

// config ความเสียหายเมื่อผู้เล่นออกนอก border
const configDamage = { cause: EntityDamageCause.void };
// ดาเมจสูงสุดที่ทำต่อรอบ
const MAX_DAMAGE = 5;
// สัดส่วนระยะแบบนอก border ที่แปลงเป็นดาเมจ
const DAMAGE_SCALE = 0.2;

// ค่าขนาด cell สำหรับรวมกลุ่มผู้เล่นใกล้กัน
const CELL_SIZE = 16;
const CELL_OFFSET = 32;
const CELL_RANGE = 64;

// ======================================================
// Look up Shrink Config (หา config การหดที่เหมาะกับรัศมีเป้าหมาย)
// ======================================================
function lookupShrinkConfig(target) {
  return SHRINK_CONFIG.find((c) => target >= c[0]) || SHRINK_CONFIG[SHRINK_CONFIG.length - 1];
}

// ======================================================
// Border Manager Get Shrink Duration (คืนเวลาที่ใช้หด border ไปยังรัศมีเป้าหมาย)
// ======================================================
export function borderManagerGetShrinkDuration(target) {
  return lookupShrinkConfig(target)[1];
}

// ======================================================
// Border Manager Get Rest Time (คืนเวลาพักก่อนเริ่มการหดรอบถัดไป)
// ======================================================
function borderManagerGetRestTime(target) {
  return lookupShrinkConfig(target)[2];
}

// ======================================================
// Reset Border State (รีเซ็ตสถานะ border ให้กลับสู่ค่าเริ่มต้นของเกม)
// ======================================================
export function resetBorderState() {
  ctx.nextShrinkIndex = 1;
  ctx.nextShrinkTick = 300;
  ctx.targetRadius = null;
  ctx.wbBounds = null;
  ctx.borderReady = false;
  ctx.shrinkStartTick = 0;
  ctx.shrinkDuration = 0;
  ctx.startRadius = CHECKPOINTS[0];
  ctx.currentBorderColor = borderColors.blue;
  endSequenceReset();
  borderManagerSetRadius(CHECKPOINTS[0]);
  ctx.borderReady = true;
  borderManagerSyncGeometry();
}

// ======================================================
// Reset Ui State (รีเซ็ต cache และสถานะของ UI / scoreboard)
// ======================================================
export function resetUiState() {
  ctx.aliveTeamDirty = true;
  ctx.aliveTeamBarCache = MinecraftColor.gray + "-";
  ctx.lastBorderRadius = -1;
  ctx.lastPlayerCount = -1;
  ctx.lastTargetRadius = null;
  scoreCache.clear();
}

// ======================================================
// Scoreboard Init (สร้าง scoreboard ใหม่และผูกกับ sidebar)
// ======================================================
export function scoreboardInit() {
  const score = world.scoreboard;
  const old = score.getObjective(uhc);
  if (old) score.removeObjective(old);
  const obj = score.addObjective(uhc, uhcName);
  score.setObjectiveAtDisplaySlot(DisplaySlotId.Sidebar, { objective: obj, sortOrder: ObjectiveSortOrder.Descending }); // score สูง = บรรทัดบน
  ctx.objective = obj;
  scoreCache.clear();
}

// ======================================================
// Scoreboard Clear (ล้าง scoreboard ออกจาก sidebar และเคลียร์ objective เดิม)
// ======================================================
export function scoreboardClear() {
  const sb = world.scoreboard;
  sb.clearObjectiveAtDisplaySlot(DisplaySlotId.Sidebar);
  const obj = sb.getObjective(uhc);
  if (obj) sb.removeObjective(obj);
  scoreCache.clear();
  ctx.objective = null;
}

const LINE_ID_SUFFIX = Array.from({ length: 10 }, (_, i) => "§r".repeat(i + 1));

// ======================================================
// Scoreboard Make Line Id(สร้าง id เฉพาะสำหรับ participant ของแต่ละบรรทัด)
// ======================================================
function scoreboardMakeLineId(text, index) {
  return `${text}${LINE_ID_SUFFIX[index] ?? "§r".repeat(index + 1)}`;
}

// ======================================================
// Scoreboard Update Line (อัปเดตบรรทัด scoreboard เฉพาะเมื่อค่ามีการเปลี่ยนจริง)
// ======================================================
function scoreboardUpdateLine(obj, index, text) {
  const cache = scoreCache;
  const old = cache.get(index);

  if (old === text) return;

  if (old) obj.removeParticipant(scoreboardMakeLineId(old, index));

  obj.setScore(scoreboardMakeLineId(text, index), 10 - index);
  cache.set(index, text);
}

// ======================================================
// Scoreboard Compute Next Label (คำนวณข้อความเวลาของเหตุการณ์ border ถัดไป)
// ======================================================
function scoreboardComputeNextLabel() {
  const t = ctx.uhcTick;

  if (ctx.nextShrinkIndex >= CHECKPOINTS.length && ctx.targetRadius === null) {
    return getEndSequenceLabel(t, ctx.endSeqState, ctx.endSeqStartTick, fillHasPendingWork());
  }

  if (ctx.targetRadius != null) {
    const r = ctx.shrinkDuration - (t - ctx.shrinkStartTick);
    return `${Math.max(0, r)}s`;
  }

  const r = ctx.nextShrinkTick - t;
  return r > 0 ? `${r}s` : `${MinecraftColor.darkBlue}NOW`;
}

// ======================================================
// Scoreboard Compute Next Border (คำนวณรัศมี border ถัดไปที่ควรแสดง)
// ======================================================
function scoreboardComputeNextBorder() {
  if (ctx.targetRadius != null) return ctx.targetRadius;
  if (ctx.nextShrinkIndex >= CHECKPOINTS.length) return borderEnd;
  return CHECKPOINTS[ctx.nextShrinkIndex];
}

// ======================================================
// Scoreboard Collect Alive Teams (รวมรายชื่อทีมที่ยังมีผู้เล่นรอดอยู่)
// ======================================================
function scoreboardCollectAliveTeams(players) {
  const aliveTeams = new Set();

  for (let i = 0, len = players.length; i < len; i++) {
    const player = players[i];
    const teamId = getPlayerTeam(player);

    if (teamId) aliveTeams.add(teamId);
  }

  return aliveTeams;
}

// ======================================================
// Scoreboard Get Alive Team Bar (สร้างแถบสีแทนทีมที่ยังรอดสำหรับแสดงบน scoreboard)
// ======================================================
function scoreboardGetAliveTeamBar(players) {
  if (ctx.aliveTeamDirty) {
    const aliveTeams = scoreboardCollectAliveTeams(players);

    if (aliveTeams.size) {
      let result = "";

      const teams = getTeamsCached();
      for (let i = 0, len = teams.length; i < len; i++) {
        const team = teams[i];

        if (aliveTeams.has(team.id)) {
          result += team.color + "▒";
        }
      }

      ctx.aliveTeamBarCache = result;
    } else {
      ctx.aliveTeamBarCache = MinecraftColor.gray + "-";
    }

    ctx.aliveTeamDirty = false;
  }

  return ctx.aliveTeamBarCache;
}

// ======================================================
// Scoreboard GetGame State (คืนสัญลักษณ์สถานะปัจจุบันของเกม)
// ======================================================
function scoreboardGetGameState() {
  if (!ctx.isRunning) return `${icons.Hourglass}`;
  if (ctx.uhcTick < 30) return `?`;
  if (!world.gameRules.pvp) return `${icons.shield}`;
  if (ctx.nextShrinkIndex < CHECKPOINTS.length) return `${icons.Sword}`;
  return `?`;
}

// ======================================================
// Scoreboard Update (อัปเดตข้อมูลทุกบรรทัดของ scoreboard ตาม state ปัจจุบัน)
// ======================================================
export function scoreboardUpdate(obj, uhcPlayers) {
  const c = ctx.targetRadius !== null ? MinecraftColor.red : MinecraftColor.white,
    pCount = uhcPlayers.length;

  if (ctx.borderRadius !== ctx.lastBorderRadius || ctx.targetRadius !== ctx.lastTargetRadius) {
    scoreboardUpdateLine(obj, 0, `${c}${icons.Border} ${ctx.borderRadius}${MinecraftColor.gray}/${scoreboardComputeNextBorder()}`);
    ctx.lastBorderRadius = ctx.borderRadius;
    ctx.lastTargetRadius = ctx.targetRadius;
  }

  scoreboardUpdateLine(obj, 1, `${c}${scoreboardComputeNextLabel()}`);

  if (pCount !== ctx.lastPlayerCount) {
    scoreboardUpdateLine(obj, 2, `${c}${icons.Bot} ${MinecraftColor.white}${pCount}`);
    ctx.lastPlayerCount = pCount;
  }

  scoreboardUpdateLine(obj, 3, scoreboardGetAliveTeamBar(uhcPlayers));
  scoreboardUpdateLine(obj, 4, scoreboardGetGameState());
}

// ======================================================
// Border Manager Sync Geometry (ซิงก์ขอบเขต Axis-Aligned Bounding Box ของ border จากรัศมีปัจจุบัน)
// ======================================================
export function borderManagerSyncGeometry() {
  const r = ctx.borderRadius,
    cx = center.x,
    cz = center.z;
  ctx.wbBounds = [cx + r, cx - r, cz - r, cz + r];
}

// ======================================================
// Border Manager Set Radius (ตั้งค่ารัศมี border โดยไม่ให้ต่ำกว่าค่าสุดท้าย)
// ======================================================
export function borderManagerSetRadius(r) {
  const clamped = Math.max(r, borderEnd);
  if (clamped === ctx.borderRadius && ctx.wbBounds) return;
  ctx.borderRadius = clamped;
  borderManagerSyncGeometry();
}

// ======================================================
// Border Manager Is Out side (ตรวจสอบว่าพิกัดอยู่ด้านนอก border หรือไม่)
// ======================================================
export function borderManagerIsOutside(x, z) {
  const b = ctx.wbBounds;
  if (!b) return false;
  return x < b[1] || x > b[0] || z < b[2] || z > b[3];
}

// ======================================================
// Border Manager Tick Shrink (อัปเดตรัศมี border ระหว่างช่วงกำลังหดทีละ tick)
// ======================================================
export function borderManagerTickShrink() {
  if (ctx.targetRadius === null || ctx.shrinkDuration <= 0) return;
  const elapsed = ctx.uhcTick - ctx.shrinkStartTick,
    progress = Math.min(1, elapsed / ctx.shrinkDuration),
    newRadius = Math.round(ctx.startRadius + (ctx.targetRadius - ctx.startRadius) * progress);
  if (newRadius !== ctx.borderRadius) {
    ctx.borderRadius = newRadius;
    borderManagerSyncGeometry();
  }
  if (progress >= 1) {
    ctx.borderRadius = ctx.targetRadius;
    borderManagerSyncGeometry();
    ctx.targetRadius = null;
    ctx.currentBorderColor = borderColors.blue;
  }
}

// ======================================================
// Border Manager Apply Shrink (เริ่มลดลง border รอบถัดไปและแจ้งผู้เล่น)
// ======================================================
function borderManagerApplyShrink() {
  if (ctx.targetRadius !== null) return;
  const players = getUhcPlayers();
  if (!players.length) return;
  if (ctx.nextShrinkIndex >= CHECKPOINTS.length) return;
  const target = CHECKPOINTS[ctx.nextShrinkIndex];
  if (!Number.isFinite(target) || target >= ctx.borderRadius) return;
  ctx.targetRadius = target;
  ctx.startRadius = ctx.borderRadius;
  ctx.shrinkStartTick = ctx.uhcTick;
  ctx.shrinkDuration = borderManagerGetShrinkDuration(target);
  ctx.nextShrinkIndex++;
  ctx.currentBorderColor = borderColors.red;
  const restTime = borderManagerGetRestTime(target);
  ctx.nextShrinkTick = ctx.shrinkStartTick + ctx.shrinkDuration + restTime;
  broadcast(players, {
    message: dynamicToast(`Border closing in to ${target}`, "textures/blocks/barrier"),
    sound: "world_noti",
  });
}

// ======================================================
// Border Manager Broad cast Warning (ส่งข้อความเตือนก่อน border เริ่มลดลง)
// ======================================================
function borderManagerBroadcastWarning() {
  const players = getUhcPlayers();
  if (!players.length) return;
  broadcast(players, {
    message: dynamicToast("Border starts shrinking in 30 seconds", "textures/ui/ErrorGlyph_small_hover"),
    sound: "noti",
  });
}

// ======================================================
// Border Manager Tick (อัปเดต logic หลักของ border ในแต่ละ tick)
// ======================================================
export function borderManagerTick() {
  if (ctx.nextShrinkIndex >= CHECKPOINTS.length) {
    endSequenceTick();
    return;
  }
  if (ctx.uhcTick === ctx.nextShrinkTick - 30) borderManagerBroadcastWarning();
  if (ctx.uhcTick >= ctx.nextShrinkTick) borderManagerApplyShrink();
}

// ======================================================
// Border Manager Apply Damage (คำนวณและทำดาเมจผู้เล่นที่ออกนอก border)
// ======================================================
function borderManagerApplyDamage(player) {
  if (!player?.isValid) return;
  const loc = player.location;
  if (!loc) return;
  const { x, z } = loc;
  const r = ctx.borderRadius;
  const dx = Math.max(0, Math.abs(x - center.x) - r);
  const dz = Math.max(0, Math.abs(z - center.z) - r);
  const outside = Math.max(dx, dz);
  if (outside <= 0) return;
  const damage = Math.min(MAX_DAMAGE, outside * DAMAGE_SCALE);
  player.applyDamage(damage, configDamage);
}

// ======================================================
// Particle Renderer Get Molang (เตรียม Molang variable สำหรับ particle ของ border)
// ======================================================
function particleRendererGetMolang(width = 8) {
  if (!ctx.borderMolang) ctx.borderMolang = new MolangVariableMap();
  ctx.borderMolang.setColorRGBA("variable.color", ctx.currentBorderColor);
  ctx.borderMolang.setFloat("variable.size", width);
  return ctx.borderMolang;
}

// ======================================================
// Particle Renderer Group By Cell (จัดกลุ่มผู้เล่นตาม cell เพื่อลดจำนวนจุดเรนเดอร์)
// ======================================================
function particleRendererGroupByCell(players) {
  groupMaps.clear();
  groupsLen = 0;

  const size = CELL_SIZE;
  const offset = CELL_OFFSET;
  const range = CELL_RANGE;

  for (let i = 0, len = players.length; i < len; i++) {
    const p = players[i];
    if (!p || !p.isValid) continue;

    const loc = p.location;
    if (!loc) continue;

    const cellX = (loc.x / size) | 0;
    const cellZ = (loc.z / size) | 0;

    const key = (cellX + offset) * range + (cellZ + offset);

    if (groupMaps.has(key)) continue;
    if (groupsLen >= GROUPS_POOL_CAP) continue;

    let group = groupsPool[groupsLen];

    if (!group) {
      group = { cellX: 0, cellZ: 0, rep: null };
      groupsPool[groupsLen] = group;
    }

    group.cellX = cellX;
    group.cellZ = cellZ;
    group.rep = p;

    groupMaps.set(key, group);
    groupsLen++;
  }

  if (groupsPool.length > GROUPS_POOL_CAP) {
    groupsPool.length = GROUPS_POOL_CAP;
  }
}

// ======================================================
// Particle Renderer SafeS pawn (spawn particle แบบ ignore error)
// ======================================================
function particleRendererSafeSpawn(dim, particleId, location, molang) {
  try {
    dim.spawnParticle(particleId, location, molang);
  } catch {}
}

// ======================================================
// Particle Renderer Render Edge (เรนเดอร์เส้นขอบด้านเดียวของ border ตามแกนที่กำหนด)
// ======================================================
function particleRendererRenderEdge(dim, fixed, rangeMin, rangeMax, playerCoord, view, step, axis, particleId, molang) {
  if (playerCoord < fixed - view || playerCoord > fixed + view) return;

  let value = rangeMin - (rangeMin % step);
  if (value < rangeMin) value += step;

  const spawned = spawnedThisTick;
  const pos = sharedPos;
  const spawn = particleRendererSafeSpawn;

  const particle = particleId;
  const mol = molang;

  const isX = axis === 0;

  const fixedMasked = (fixed & 0x7fff) << 15;
  const axisShift = axis << 30;
  const mask = 0x7fff;

  for (; value <= rangeMax; value += step) {
    const key = axisShift | fixedMasked | (value & mask);

    if (spawned.has(key)) continue;
    spawned.add(key);

    if (isX) {
      pos.x = fixed;
      pos.z = value;
    } else {
      pos.x = value;
      pos.z = fixed;
    }

    spawn(dim, particle, pos, mol);
  }
}

// ======================================================
// Particle Renderer Render Borde Axis-Aligned Bounding Box (เรนเดอร์ border แบบสี่เหลี่ยมจากขอบเขตปัจจุบัน)
// ======================================================
function particleRendererRenderBorderAABB(dim, step, molang) {
  if (!dim || !groupsLen || !ctx.wbBounds) return;
  const [east, west, north, south] = ctx.wbBounds,
    view = BORDER_RENDER.VIEW_DISTANCE;
  spawnedThisTick.clear();
  for (let i = 0; i < groupsLen; i++) {
    const rep = groupsPool[i].rep;
    if (!rep?.isValid) continue;
    const loc = rep.location;
    if (!loc) continue;
    const px = loc.x,
      pz = loc.z,
      minX = px - view,
      maxX = px + view,
      minZ = pz - view,
      maxZ = pz + view;
    if (px > east - view) particleRendererRenderEdge(dim, east, Math.max(north, minZ), Math.min(south, maxZ), px, view, step, 0, worldborder, molang);
    if (px < west + view) particleRendererRenderEdge(dim, west, Math.max(north, minZ), Math.min(south, maxZ), px, view, step, 0, worldborder, molang);
    if (pz < north + view)
      particleRendererRenderEdge(dim, north, Math.max(west, minX), Math.min(east, maxX), pz, view, step, 1, worldborder_ew, molang);
    if (pz > south - view)
      particleRendererRenderEdge(dim, south, Math.max(west, minX), Math.min(east, maxX), pz, view, step, 1, worldborder_ew, molang);
  }
}

// ======================================================
// Particle Renderer Render Small (เรนเดอร์ border แบบย่อเมื่อรัศมีเล็กมาก)
// ======================================================
function particleRendererRenderSmall(dim) {
  const n = ctx.borderRadius;
  const molang = particleRendererGetMolang(n);
  const pos = particleLocPool;

  pos.y = BORDER_RENDER.PARTICLE_Y;

  try {
    pos.x = n;
    pos.z = 0;
    dim.spawnParticle(worldborder, pos, molang);

    pos.x = -n;
    dim.spawnParticle(worldborder, pos, molang);

    pos.x = 0;
    pos.z = n;
    dim.spawnParticle(worldborder_ew, pos, molang);

    pos.z = -n;
    dim.spawnParticle(worldborder_ew, pos, molang);
  } catch {}
}

// ======================================================
// Particle Renderer Tick (อัปเดตดาเมจนอก border และ particle ตาย tick)
// ======================================================
export function particleRendererTick(players) {
  if (!ctx.isRunning || !ctx.borderReady || !ctx.wbBounds) return;
  for (let i = 0; i < players.length; i++) borderManagerApplyDamage(players[i]);
  if (ctx.uhcTick % 4 !== 0) return;
  particleRendererGroupByCell(players);
  if (!groupsLen) return;
  let dim = null;
  for (let i = 0; i < groupsLen; i++) {
    const rep = groupsPool[i].rep;
    if (rep?.isValid) {
      dim = rep.dimension;
      break;
    }
  }
  if (!dim) return;
  if (ctx.borderRadius < 100) {
    particleRendererRenderSmall(dim);
    return;
  }
  particleRendererRenderBorderAABB(dim, 16, particleRendererGetMolang(8));
}

// ======================================================
// Sequence Reset (รีเซ็ตสถานะของ end sequence หลัง border สุดท้าย)
// ======================================================
export function endSequenceReset() {
  ctx.endSeqState = 0;
  ctx.endSeqStartTick = -1;
}

// ======================================================
// End Sequence Tick (การทำงาน sequence ตาม state และเวลา)
// ======================================================
function endSequenceTick() {
  if (ctx.endSeqState === END_SEQUENCE_STATE.COMPLETED) return;
  if (ctx.targetRadius !== null) return;

  if (ctx.endSeqStartTick === -1) {
    ctx.endSeqStartTick = ctx.uhcTick;
    broadcast(getUhcPlayers(), {
      message: dynamicToast("Border fully closed!", "textures/blocks/barrier"),
      sound: "world_noti",
    });
    return;
  }

  if (!shouldAdvanceEndSequence(ctx.uhcTick, ctx.endSeqState, ctx.endSeqStartTick, fillHasPendingWork())) return;

  const step = getEndSequenceStep(ctx.endSeqState);
  if (!step) return;

  ctx.endSeqState = step.nextState;
  ctx.endSeqStartTick = ctx.uhcTick;

  const players = getUhcPlayers();
  broadcast(players, { message: dynamicToast(step.message, step.icon), sound: "world_noti" });

  for (let i = 0, len = players.length; i < len; i++) {
    const player = players[i];
    if (player?.isValid && typeof step.run === "function") {
      step.run(player);
    }
  }
}

// ======================================================
// Broad Cast (message/title/subtitle/sound ไปยังผู้เล่นที่ระบุ)
// ======================================================
export function broadcast(targetOrPayload, maybePayload) {
  let targets, payload;

  if (maybePayload !== undefined) {
    targets = targetOrPayload;
    payload = maybePayload;
  } else {
    targets = getAllPlayers();
    payload = targetOrPayload;
  }

  if (!payload || !targets?.length) return;

  const { message, title, subtitle, sound } = payload;

  const hasMessage = typeof message === "string";
  const hasTitle = typeof title === "string" || typeof subtitle === "string";
  const hasSound = typeof sound === "string";

  if (!hasMessage && !hasTitle && !hasSound) return;

  let titleOptions;
  if (hasTitle) {
    reusableTitleOptions.subtitle = typeof subtitle === "string" ? subtitle : "";
    titleOptions = reusableTitleOptions;
  }

  for (let i = 0; i < targets.length; i++) {
    const player = targets[i];
    if (!player?.isValid) continue;

    if (hasMessage) player.sendMessage(message);

    if (hasTitle) {
      player.onScreenDisplay.setTitle(typeof title === "string" ? title : "", titleOptions);
    }

    if (hasSound) player.playSound(sound, soundConfig);
  }
}
