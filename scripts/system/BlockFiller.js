import { BlockPermutation, system, world } from "@minecraft/server";

// @ts-ignore
import { CHECKPOINTS, ctx } from "./BorderManager";

// @ts-ignore
import { MODE, END_SEQUENCE_STATE, BLOCK_CATEGORIES } from "./BlockFillerUtil";
export { END_SEQUENCE_STATE } from "./BlockFillerUtil";

// CONFIG
// กำหนดขอบเขตความสูงต่ำสุด/สูงสุดของโลกที่ระบบจะเติมบล็อก
const WORLD_MIN_Y = -64;
const WORLD_MAX_Y = 319;
// จำนวนบล็อกที่ประมวลผลต่อรอบในสถานะปกติและช่วงท้ายเกม
const BATCH_SIZE_NORMAL = 120;
const BATCH_SIZE_ENDGAME = 400;
// ความถี่ของลูปหลักและค่าที่ใช้แปลง tick เป็นวินาที
const FILL_INTERVAL_TICKS = 1;
const TICKS_PER_SECOND = 20;
// เพดานของคิวงานและจำนวนบล็อกที่รอประมวลผลพร้อมกัน
const TASK_QUEUE_HARD_CAP = 8000;
const MAX_PENDING_BLOCKS = 80000;
const MAX_BLOCKS_PER_TASK = 250_000;
const COMPACT_THRESHOLD = 256;
// ทิศทางการเติมบล็อกตามแกน Y
const UPWARD_Y = 1;
const DOWNWARD_Y = -1;
// ค่าที่ใช้ควบคุม retry queue เมื่อ chunk ยังไม่พร้อม
const RETRY_QUEUE_LIMIT = 4000;
const RETRY_BASE_DELAY_TICKS = 12;

// แผนที่เก็บรายการ permutation แยกตามโหมด
const CATEGORY_MAP = new Map();

// แคช permutation ที่ resolve แล้ว เพื่อลดการสร้างซ้ำ
const PERM_CACHE = new Map();

// คิวงานเติมบล็อกหลัก และคิว retry เมื่อ chunk ยังไม่พร้อม
const TASK_QUEUE = [];
const RETRY_QUEUE = [];

// เก็บ reference ของ block อากาศ (lazy init)
let AIR;

// id ของ interval สำหรับคำสั่ง fill
let fillIntervalId = null;

// index หัวคิว (ใช้กับ queue แบบ manual)
let queueHead = 0;

// จำนวนบล็อกที่รอประมวลผล
let pendingBlocks = 0;

// index ล่าสุดที่สุ่ม (กันซ้ำ)
let lastRandomIndex = -1;

// งาน pattern แบบ layered ที่ยังทำงานอยู่
const ACTIVE_LAYERED_TASKS = [];

// แคชสถานะว่า chunk ตำแหน่งใดโหลดแล้วใน tick ปัจจุบัน
const chunkLoadedCache = Object.create(null);

// ตัวชี้วัด runtime สำหรับเอาไปแสดงสถานะงานเติมบล็อก
const runtimeMetrics = {
  lastProcessedBlocks: 0 | 0,
  activeQueueSize: 0 | 0,
  retryQueueSize: 0 | 0,
  pendingBlocks: 0 | 0,
};

// ======================================================
// InitPermutations (resolve block id เป็น BlockPermutation พร้อมใช้งานแคช)
// ======================================================
const MAX_CACHE_SIZE = 256; // การจัดการ Block Permutation / Chunk Awareness
function resolveBlock(id) {
  if (PERM_CACHE.has(id)) return PERM_CACHE.get(id);

  if (PERM_CACHE.size >= MAX_CACHE_SIZE) {
    const firstKey = PERM_CACHE.keys().next().value;
    PERM_CACHE.delete(firstKey);
  }

  const perm = BlockPermutation.resolve(id);
  PERM_CACHE.set(id, perm);
  return perm;
}

// ======================================================
// InitPermutations (เตรียม permutation ทั้งหมดที่จำเป็นก่อนเริ่มสร้างงานเติมบล็อก)
// ======================================================
function initPermutations() {
  if (AIR) return;

  AIR = resolveBlock("minecraft:air");
  const categorySources = [
    [MODE.ORE, BLOCK_CATEGORIES.ore],
    [MODE.NETHER, BLOCK_CATEGORIES.nether],
    [MODE.CONCRETE, BLOCK_CATEGORIES.concrete],
    [MODE.RANDOM, BLOCK_CATEGORIES.random],
  ];

  for (let i = 0; i < categorySources.length; i++) {
    const [mode, blockIds] = categorySources[i];
    const permutations = new Array(blockIds.length);

    for (let j = 0; j < blockIds.length; j++) {
      permutations[j] = resolveBlock(blockIds[j]);
    }

    CATEGORY_MAP.set(mode, permutations);
  }
}

// ======================================================
// FastRandomInt (สุ่มเลขจำนวนเต็มแบบเร็วโดยใช้ pseudo-random generator ภายใน)
// ======================================================
let seed = (Math.random() * 0xffffffff) >>> 0;
// seed สำหรับตัวสุ่มแบบเร็วที่ใช้เลือกบล็อก
if (seed === 0) seed = 1;
function fastRandomInt(max) {
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  const result = (t ^ (t >>> 14)) >>> 0;
  return result % max;
}

// ======================================================
// Random Block (สุ่มบล็อกจากหมวดที่กำหนด โดยพยายามไม่ให้ซ้ำกับครั้งก่อน)
// ======================================================
function randomBlock(mode) {
  const permutations = CATEGORY_MAP.get(mode);
  if (!permutations || permutations.length === 0) return AIR;
  let index;
  do {
    index = fastRandomInt(permutations.length);
  } while (index === lastRandomIndex && permutations.length > 1);
  lastRandomIndex = index;
  return permutations[index] ?? AIR;
}

// ======================================================
// Create Block Resolver (สร้างฟังก์ชันเลือกบล็อกตามโหมดและตัวเลือกการ fill)
// ======================================================
function createBlockResolver(mode, fillOptions = {}) {
  if (fillOptions.blockId) {
    const fixedPermutation = resolveBlock(fillOptions.blockId);
    return () => fixedPermutation;
  }
  switch (mode) {
    case MODE.CLEAR:
      return () => AIR;
    case MODE.NETHER:
      return () => randomBlock(mode);
    default: {
      if (fillOptions.randomize) return () => randomBlock(mode);
      const staticPermutation = CATEGORY_MAP.get(mode)?.[0] ?? AIR;
      return () => staticPermutation;
    }
  }
}

// ======================================================
// Reseed Random (เปลี่ยน seed บางส่วนเป็นระยะ เพื่อลดความซ้ำของแพทเทิร์นสุ่ม)
// ======================================================
function reseedRandom() {
  seed ^= (Math.random() * 0xffffffff) >>> 0;
}

// ======================================================
//
// Main Tick (เลูปหลักของระบบ เติมคิวหลัก คิว retry และงาน layered ในแต่ละ tick)
//
// ======================================================
function mainTick() {
  for (const k in chunkLoadedCache) delete chunkLoadedCache[k];

  if (system.currentTick % 6000 === 0) {
    reseedRandom();
  }

  let processedThisTick = 0;

  try {
    processedThisTick += processFillQueue();
    processRetryQueue();
    processLayeredTasks();

    if ((system.currentTick & 3) === 0) {
      runtimeMetrics.lastProcessedBlocks = processedThisTick | 0;
      runtimeMetrics.activeQueueSize = (TASK_QUEUE.length - queueHead) | 0;
      runtimeMetrics.retryQueueSize = RETRY_QUEUE.length | 0;
      runtimeMetrics.pendingBlocks = pendingBlocks | 0;
    }

    if (system.currentTick % 100 === 0) {
      for (let i = ACTIVE_LAYERED_TASKS.length - 1; i >= 0; i--) {
        const lt = ACTIVE_LAYERED_TASKS[i];
        if (lt.stopped || !lt.player?.isValid) {
          ACTIVE_LAYERED_TASKS.splice(i, 1);
        }
      }
    }
  } catch (e) {
    console.error("[BlockFiller] mainTick error:", e);
    fillReset();
  }
}

// ======================================================
// Get Adaptive Batch Size (เลือก batch size ให้เหมาะกับสถานะเกมปัจจุบัน)
// ======================================================
function getAdaptiveBatchSize() {
  return ctx?.nextShrinkIndex >= CHECKPOINTS?.length ? BATCH_SIZE_ENDGAME : BATCH_SIZE_NORMAL;
}

// ======================================================
// Process Fill Queue (ประมวลผลงานในคิวหลักตามโควตาของ tick ปัจจุบัน)
// ======================================================
function processFillQueue() {
  const isEndgame = ctx?.nextShrinkIndex >= CHECKPOINTS?.length;
  if (!isEndgame && system.currentTick % 2 !== 0) return 0;

  const BATCH_SIZE = isEndgame ? BATCH_SIZE_ENDGAME : BATCH_SIZE_NORMAL;
  let processed = 0;
  let head = queueHead;
  const queue = TASK_QUEUE;

  while (head < queue.length && processed < BATCH_SIZE) {
    const task = queue[head];

    let result;
    try {
      result = task(BATCH_SIZE - processed);
    } catch {
      head++;
      continue;
    }

    if (result.blocked) {
      pushRetry(task, normalizeRemaining(result.remaining));
      head++;
      continue;
    }

    const consumed = result.consumed | 0;

    if (consumed > 0) {
      processed += consumed;
      pendingBlocks -= consumed;
      if (pendingBlocks < 0) pendingBlocks = 0;
    }

    if (result.done) head++;
  }

  queueHead = head;
  if (queueHead > COMPACT_THRESHOLD) compactQueue();

  return processed;
}

// ======================================================
//
//                  Queue Management
//
// ======================================================
// Can Queue Task(ตรวจสอบว่างานใหม่สามารถเข้าคิวได้หรือไม่)
// ======================================================
function canQueueTask(blockCount) {
  if (blockCount > MAX_BLOCKS_PER_TASK) return false;
  if (TASK_QUEUE.length - queueHead >= TASK_QUEUE_HARD_CAP) return false;
  if (pendingBlocks + blockCount >= MAX_PENDING_BLOCKS) return false;
  return true;
}

// ======================================================
// Queue Task (เพิ่มงานเข้า queue หลักและอัปเดตจำนวนบล็อกที่รอทำ)
// ======================================================
function queueTask(task, blockCount) {
  if (typeof task !== "function") return false;
  if (blockCount <= 0 || !Number.isFinite(blockCount)) return false;

  if (!canQueueTask(blockCount)) return false;

  TASK_QUEUE.push(task);

  pendingBlocks += blockCount;
  if (pendingBlocks > MAX_PENDING_BLOCKS) {
    pendingBlocks = MAX_PENDING_BLOCKS;
  }

  startFillLoopIfNeeded();
  return true;
}

// ======================================================
// Compact Queue (ตัดหัวคิวที่ประมวลผลไปแล้วออก เพื่อลดขนาดอาร์เรย์)
// ======================================================
function compactQueue() {
  TASK_QUEUE.splice(0, queueHead);
  queueHead = 0;
}

// ======================================================
// Fill Add Task (เพิ่มงานเข้าสู่ระบบ ถ้าคิวหลักเต็มจะถูกส่งไป retry queue)
// ======================================================
function fillAddTask(task, blockCount) {
  if (typeof task !== "function") return;
  if (blockCount <= 0 || !Number.isFinite(blockCount)) return;

  if (!queueTask(task, blockCount)) {
    pushRetry(task, blockCount);
  }
}

// ======================================================
// Normalize Remaining (ทำให้ค่าจำนวนบล็อกคงเหลืออยู่ในรูปจำนวนเต็มที่ปลอดภัย)
// ======================================================
function normalizeRemaining(value) {
  if (!Number.isFinite(value)) return 0;
  if (value <= 0) return 0;
  return value | 0;
}

// ======================================================
//
//          Retry Queue + Exponential Backoff
//
// ======================================================
// Push Retry (เพิ่มงานที่ติด chunk/block ชั่วคราวเข้า retry queue)
// ======================================================
function pushRetry(task, blockCount) {
  if (typeof task !== "function") return;
  if (blockCount <= 0 || !Number.isFinite(blockCount)) return;

  const headroom = MAX_PENDING_BLOCKS - pendingBlocks;
  const clampedCount = Math.min(blockCount, Math.max(0, headroom));

  if (RETRY_QUEUE.length >= RETRY_QUEUE_LIMIT) {
    const removed = RETRY_QUEUE.shift();
    if (removed) {
      pendingBlocks -= removed.blockCount;
      if (pendingBlocks < 0) pendingBlocks = 0;
    }
  }

  if (clampedCount <= 0) return;

  RETRY_QUEUE.push({
    task,
    blockCount: clampedCount,
    nextTryTick: system.currentTick + RETRY_BASE_DELAY_TICKS,
    attempts: 0,
  });
}

// ======================================================
// Process Retry Queue (ลองย้ายงานจาก retry queue กลับเข้า queue หลักตามจังหวะเวลา)
// ======================================================
const MAX_ATTEMPTS = 20;
function processRetryQueue() {
  if (RETRY_QUEUE.length === 0) return;

  let i = 0;
  let processed = 0;
  const now = system.currentTick;

  while (i < RETRY_QUEUE.length && processed < 35) {
    const entry = RETRY_QUEUE[i];

    if (entry.nextTryTick > now) {
      i++;
      continue;
    }

    if (entry.attempts >= MAX_ATTEMPTS) {
      pendingBlocks -= entry.blockCount;
      if (pendingBlocks < 0) pendingBlocks = 0;
      // Swap-and-pop
      RETRY_QUEUE[i] = RETRY_QUEUE[RETRY_QUEUE.length - 1];
      RETRY_QUEUE.pop();
      continue;
    }

    if (canQueueTask(entry.blockCount) && queueTask(entry.task, entry.blockCount)) {
      // Swap-and-pop
      RETRY_QUEUE[i] = RETRY_QUEUE[RETRY_QUEUE.length - 1];
      RETRY_QUEUE.pop();
      processed++;
      continue;
    }

    entry.attempts = (entry.attempts + 1) | 0;
    entry.nextTryTick = now + Math.min(RETRY_BASE_DELAY_TICKS * entry.attempts, 60);

    i++;
  }
}

// ======================================================
//
//           Layered Pattern Central Scheduler
//
// ======================================================
// Process Layered Tasks (เดินงาน pattern แบบไล่ทีละชั้นสำหรับผู้เล่นที่ลงทะเบียนไว้)
// ======================================================
function processLayeredTasks() {
  for (let i = ACTIVE_LAYERED_TASKS.length - 1; i >= 0; i--) {
    const lt = ACTIVE_LAYERED_TASKS[i];
    if (lt.stopped || !lt.player?.isValid) {
      ACTIVE_LAYERED_TASKS.splice(i, 1);
      continue;
    }

    if (system.currentTick % lt.delay !== 0) continue;

    const y = lt.baseY - lt.layer;
    if (y < WORLD_MIN_Y) {
      lt.stopped = true;
      continue;
    }

    if (lt.patternTask.rotationCache) {
      enqueueRotatedPatternSegments(lt.dim, y, lt.patternTask, lt.rotationIndex);
      lt.rotationIndex = (lt.rotationIndex + 1) & 3;
    } else {
      enqueuePatternSegments(lt.dim, y, lt.patternTask);
    }
    lt.layer++;
  }
}

// ======================================================
// Register Layered Task (ลงทะเบียนงาน pattern แบบ layered ให้ผูกกับผู้เล่น)
// ======================================================

export function registerLayeredTask(player, patternTask) {
  if (!player?.isValid) return;
  for (let i = 0; i < ACTIVE_LAYERED_TASKS.length; i++) {
    const t = ACTIVE_LAYERED_TASKS[i];
    if (t.player === player && t.patternTask.name === patternTask.name) {
      return;
    }
  }

  const dim = player.dimension;
  const baseY = patternTask.startTopY ?? ~~player.location.y - 1;

  ACTIVE_LAYERED_TASKS.push({
    player,
    dim,
    patternTask,
    baseY,
    layer: 0,
    rotationIndex: 0,
    delay: patternTask.delay ?? 20,
    stopped: false,
  });
}

// ======================================================
// Calculate Bounds (คำนวณขอบเขตพื้นที่เติมบล็อกให้อยู่ในรูป min/max ที่ใช้งานง่าย)
// ======================================================
function calculateBounds(x1, y1, z1, x2, y2, z2) {
  const minX = Math.min(x1, x2);
  const maxX = Math.max(x1, x2);
  const minZ = Math.min(z1, z2);
  const maxZ = Math.max(z1, z2);
  const minY = Math.max(WORLD_MIN_Y, Math.min(y1, y2));
  const maxY = Math.min(WORLD_MAX_Y, Math.max(y1, y2));

  if (minX < -30000000 || maxX > 30000000 || minZ < -30000000 || maxZ > 30000000) {
    return null;
  }
  return { minX, maxX, minY, maxY, minZ, maxZ };
}

// ======================================================
// Calculate Block Count (คำนวณจำนวนบล็อกทั้งหมดภายใน bounds ที่กำหนด)
// ======================================================
function calculateBlockCount(bounds) {
  return (bounds.maxX - bounds.minX + 1) * (bounds.maxZ - bounds.minZ + 1) * (bounds.maxY - bounds.minY + 1);
}

// ======================================================
// Split Bounds (แบ่งพื้นที่ใหญ่เกินไปออกเป็นพื้นที่ย่อยเพื่อไม่ให้เกิน limit ต่อ task)
// ======================================================
function splitBounds(bounds, stack, yDirection = UPWARD_Y) {
  const sizeX = bounds.maxX - bounds.minX;
  const sizeY = bounds.maxY - bounds.minY;
  const sizeZ = bounds.maxZ - bounds.minZ;

  if (sizeX >= sizeY && sizeX >= sizeZ) {
    const mid = (bounds.minX + bounds.maxX) >> 1;
    stack.push({ minX: bounds.minX, maxX: mid, minY: bounds.minY, maxY: bounds.maxY, minZ: bounds.minZ, maxZ: bounds.maxZ });
    stack.push({ minX: mid + 1, maxX: bounds.maxX, minY: bounds.minY, maxY: bounds.maxY, minZ: bounds.minZ, maxZ: bounds.maxZ });
    return;
  }

  if (sizeZ >= sizeY) {
    const mid = (bounds.minZ + bounds.maxZ) >> 1;
    stack.push({ minX: bounds.minX, maxX: bounds.maxX, minY: bounds.minY, maxY: bounds.maxY, minZ: bounds.minZ, maxZ: mid });
    stack.push({ minX: bounds.minX, maxX: bounds.maxX, minY: bounds.minY, maxY: bounds.maxY, minZ: mid + 1, maxZ: bounds.maxZ });
    return;
  }

  const mid = (bounds.minY + bounds.maxY) >> 1;
  const lower = { minX: bounds.minX, maxX: bounds.maxX, minY: bounds.minY, maxY: mid, minZ: bounds.minZ, maxZ: bounds.maxZ };
  const upper = { minX: bounds.minX, maxX: bounds.maxX, minY: mid + 1, maxY: bounds.maxY, minZ: bounds.minZ, maxZ: bounds.maxZ };

  if (yDirection === DOWNWARD_Y) {
    stack.push(lower);
    stack.push(upper);
  } else {
    stack.push(upper);
    stack.push(lower);
  }
}

// ======================================================
// Create Bounds Taskk (สร้าง task สำหรับเติมบล็อกใน bounds เดียวแบบค่อย ๆ ทำตาม limit)
// ======================================================
function createBoundsTask(dim, bounds, mode, yDirection = UPWARD_Y, fillOptions = {}) {
  let x = bounds.minX;
  let y = yDirection === DOWNWARD_Y ? bounds.maxY : bounds.minY;
  let z = bounds.minZ;

  const totalBlockCount = calculateBlockCount(bounds);

  let remaining = totalBlockCount;

  const resolvePermutation = createBlockResolver(mode, fillOptions);
  const isStatic = !fillOptions.randomize && !fillOptions.blockId && mode !== MODE.NETHER;
  const staticPerm = isStatic ? resolvePermutation() : null;
  const staticPermTypeId = staticPerm ? (staticPerm.typeId ?? staticPerm?.type?.id ?? "") : null;

  const minX = bounds.minX,
    maxX = bounds.maxX;

  const minY = bounds.minY,
    maxY = bounds.maxY;

  const minZ = bounds.minZ,
    maxZ = bounds.maxZ;

  return (limit) => {
    let consumed = 0;
    if ((yDirection === DOWNWARD_Y && y < minY) || (yDirection !== DOWNWARD_Y && y > maxY)) {
      return { consumed: 0, done: true };
    }

    while (consumed < limit) {
      if (y >= WORLD_MIN_Y && y <= WORLD_MAX_Y) {
        const chunkKey = ((x >> 4) << 16) | ((z >> 4) & 0xffff);
        let chunkOk = chunkLoadedCache[chunkKey];
        if (chunkOk === undefined) {
          try {
            const testBlock = dim.getBlock({ x, y: 0, z });
            chunkOk = !!testBlock;
          } catch {
            chunkOk = false;
          }
          chunkLoadedCache[chunkKey] = chunkOk;
        }

        if (!chunkOk) {
          return { consumed, done: false, blocked: true, remaining };
        }

        const block = dim.getBlock({ x, y, z });
        if (!block) {
          return { consumed, done: false, blocked: true, remaining };
        }

        const perm = staticPerm ?? resolvePermutation();
        const permTypeId = staticPermTypeId ?? perm.typeId ?? perm?.type?.id ?? "";

        if (block.typeId !== permTypeId) {
          try {
            block.setPermutation(perm);
          } catch {
            return { consumed, done: false, blocked: true, remaining };
          }
        }
        consumed++;
        remaining--;
      }

      x++;
      if (x <= maxX) continue;
      x = minX;
      z++;
      if (z <= maxZ) continue;
      z = minZ;
      y += yDirection;
      if ((yDirection === DOWNWARD_Y && y < minY) || (yDirection !== DOWNWARD_Y && y > maxY)) {
        return { consumed, done: true };
      }
    }
    return { consumed, done: false, remaining };
  };
}

// ======================================================
// Create Fill Task (สร้างชุด task ย่อยจากพื้นที่เติมบล็อกทั้งหมด)
// ======================================================
function createFillTask(dim, x1, y1, z1, x2, y2, z2, mode, yDirection = UPWARD_Y, fillOptions = {}) {
  initPermutations();
  const initialBounds = calculateBounds(x1, y1, z1, x2, y2, z2);
  if (!initialBounds) return [];
  const pendingBounds = [initialBounds];
  const segments = [];
  while (pendingBounds.length) {
    const bounds = pendingBounds.pop();
    const blockCount = calculateBlockCount(bounds);
    if (blockCount > MAX_BLOCKS_PER_TASK) {
      splitBounds(bounds, pendingBounds, yDirection);
      continue;
    }
    segments.push({
      task: createBoundsTask(dim, bounds, mode, yDirection, fillOptions),
      blockCount,
    });
  }
  return segments;
}

// ======================================================
//
//                     Pattern
//
// ======================================================
// Create Pattern Segment (สร้างข้อมูลชิ้นส่วน pattern หนึ่งชิ้นแบบ immutable)
// ======================================================
function createPatternSegment(name, x1, z1, x2, z2) {
  return Object.freeze({ name, x1, z1, x2, z2 });
}

// ======================================================
// Rotate Pattern Segment (หมุน segment 90 องศารอบจุดศูนย์กลาง)
// ======================================================
function rotatePatternSegment(segment) {
  const x1 = segment.z1;
  const z1 = -segment.x1;
  const x2 = segment.z2;
  const z2 = -segment.x2;
  return createPatternSegment(segment.name, Math.min(x1, x2), Math.min(z1, z2), Math.max(x1, x2), Math.max(z1, z2));
}

// ======================================================
// Build Pattern Rotation Cache (สร้างแคช pattern ที่หมุนไว้ครบ 4 ทิศ)
// ======================================================
function buildPatternRotationCache(segments) {
  const rotation1 = segments.map(rotatePatternSegment);
  const rotation2 = rotation1.map(rotatePatternSegment);
  const rotation3 = rotation2.map(rotatePatternSegment);
  return [segments, rotation1, rotation2, rotation3];
}

// ======================================================
// Create Pattern Task (สร้าง pattern task พร้อมตัวเลือกทิศทาง ความหน่วง และการหมุน)
// ======================================================
function createPatternTask(name, mode, segments, options = {}) {
  return Object.freeze({
    name,
    mode,
    segments,
    yDirection: options.yDirection ?? UPWARD_Y,
    delay: options.delay ?? 20,
    fillBottomY: options.fillBottomY ?? null,
    startTopY: options.startTopY ?? null,
    fillOptions: Object.freeze({ ...(options.fillOptions ?? {}) }),
    rotationCache: options.useRotation ? buildPatternRotationCache(segments) : null,
  });
}

// ======================================================
//
//                  Pattern Segment
//
// ======================================================
// Enqueue Pattern Segment (แปลง segment ให้เป็นงานเติมบล็อกจริงแล้วส่งเข้าคิว)
// ======================================================
function enqueuePatternSegment(dim, segment, startY, endY, mode, yDirection = UPWARD_Y, fillOptions = {}) {
  const segments = createFillTask(dim, segment.x1, startY, segment.z1, segment.x2, endY, segment.z2, mode, yDirection, fillOptions);
  if (!segments || segments.length === 0) return;
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    if (!seg || typeof seg.task !== "function") continue;
    fillAddTask(seg.task, seg.blockCount);
  }
}

// ======================================================
// Enqueue Pattern Segments (ส่งทุก segment ของ pattern เข้า queue ที่ระดับ Y ที่กำหนด)
// ======================================================
function enqueuePatternSegments(dim, y, patternTask) {
  const endY = patternTask.fillBottomY ?? y;
  for (let i = 0; i < patternTask.segments.length; i++) {
    enqueuePatternSegment(dim, patternTask.segments[i], y, endY, patternTask.mode, patternTask.yDirection, patternTask.fillOptions);
  }
}

// ======================================================
// Enqueue Rotated Pattern Segments (ส่ง segment ของ pattern เวอร์ชันที่หมุนแล้วเข้า queue)
// ======================================================
function enqueueRotatedPatternSegments(dim, y, patternTask, rotationIndex) {
  const rotation = patternTask.rotationCache?.[rotationIndex];
  if (!rotation) return;
  for (let i = 0; i < rotation.length; i++) {
    enqueuePatternSegment(dim, rotation[i], y, y, patternTask.mode, patternTask.yDirection, patternTask.fillOptions);
  }
}

// ======================================================
// Start Fill Loop If Needed (เริ่มลูปเติมบล็อก หากระบบยังไม่ได้ทำงานอยู่)
// ======================================================
function startFillLoopIfNeeded() {
  if (fillIntervalId !== null) return;

  fillIntervalId = system.runInterval(() => {
    if (!fillIntervalId) return;
    mainTick();
  }, FILL_INTERVAL_TICKS);
}

// ======================================================
//
//                     STATE API
//
// ======================================================
// Fill Reset (รีเซ็ตสถานะและคิวทั้งหมดของระบบเติมบล็อก)
// ======================================================
export function fillReset() {
  if (fillIntervalId !== null) {
    system.clearRun(fillIntervalId);
    fillIntervalId = null;
  }

  TASK_QUEUE.length = 0;
  RETRY_QUEUE.length = 0;
  ACTIVE_LAYERED_TASKS.length = 0;

  queueHead = 0;
  pendingBlocks = 0;
  lastRandomIndex = -1;
  pattern1Queued = false;
  pattern2Queued = false;
}

// ======================================================
// FillIs Idle (ตรวจสอบว่าระบบเติมบล็อกหยุดอยู่หรือไม่)
// ======================================================
function fillIsIdle() {
  return fillIntervalId === null;
}

// ======================================================
// Fill Estimate Remaining Seconds (ประเมินเวลาที่เหลือโดยอิงจาก pending blocks และ batch size ปัจจุบัน)
// ======================================================
function fillEstimateRemainingSeconds() {
  if (pendingBlocks <= 0 || fillIsIdle()) return 0;
  const batchSize = getAdaptiveBatchSize();

  const isEndgame = ctx?.nextShrinkIndex >= CHECKPOINTS?.length;
  const fillsPerSecond = isEndgame ? TICKS_PER_SECOND : TICKS_PER_SECOND / 2;
  return Math.max(1, Math.ceil(pendingBlocks / (batchSize * fillsPerSecond)));
}

// ======================================================
// Fill Has Pending Work (ระบบยังมีงานเติมบล็อกค้างอยู่หรือไม่)
// ======================================================
export function fillHasPendingWork() {
  return !fillIsIdle() && pendingBlocks > 0;
}

// ======================================================
// Should Advance End Sequence (ตัดสินว่า end sequence ควรขยับไป state ถัดไปหรือยัง)
// ======================================================
export function shouldAdvanceEndSequence(uhcTick, state, startTick, hasPendingWork) {
  if (startTick === -1) return false;
  const elapsed = uhcTick - startTick;
  switch (state) {
    case END_SEQUENCE_STATE.INITIAL_WAIT:
      return elapsed >= 100;
    case END_SEQUENCE_STATE.PATTERN3:
    case END_SEQUENCE_STATE.PATTERN1:
    case END_SEQUENCE_STATE.PATTERN2:
      return !hasPendingWork && elapsed >= 40;
    case END_SEQUENCE_STATE.COOLDOWN:
      return elapsed >= 100;
    default:
      return false;
  }
}

// ======================================================
// Get End Sequence Step (คืนค่าข้อมูลของขั้นตอน end sequence ตาม state ปัจจุบัน)
// ======================================================
export function getEndSequenceStep(state) {
  const END_SEQUENCE_STEPS = [
    {
      nextState: END_SEQUENCE_STATE.PATTERN3,
      labelKey: "pattern3",
      message: "Nether wall border",
      icon: "textures/blocks/nether_brick",
      run: runEndPattern3,
    },
    {
      nextState: END_SEQUENCE_STATE.PATTERN1,
      labelKey: "pattern1",
      message: "Outer ring clear",
      icon: "textures/blocks/barrier",
      run: runEndPattern1,
    },
    {
      nextState: END_SEQUENCE_STATE.COOLDOWN,
      labelKey: "cooldown",
      message: "Waiting to continue",
      icon: "textures/blocks/glass_blue",
      run: () => {},
    },
    {
      nextState: END_SEQUENCE_STATE.PATTERN2,
      labelKey: "pattern2",
      message: "Inner ring clear",
      icon: "textures/blocks/diamond_ore",
      run: runEndPattern2,
    },
  ];
  return END_SEQUENCE_STEPS[state] ?? null;
}

// ======================================================
// Get End Sequence Labe (สร้างข้อความสถานะสำหรับแสดงความคืบหน้าของ end sequence)
// ======================================================
export function getEndSequenceLabel(uhcTick, state, startTick, hasPendingWork) {
  const elapsed = startTick === -1 ? 0 : uhcTick - startTick;
  const remTime = Math.max(0, 100 - elapsed);
  const fillTime = fillEstimateRemainingSeconds();
  const fillStatus = hasPendingWork
    ? `Filling ${fillTime}s (Blocks ${runtimeMetrics.pendingBlocks}, Queue ${runtimeMetrics.activeQueueSize})`
    : `Complete | Blocks ${runtimeMetrics.pendingBlocks} | Queue ${runtimeMetrics.activeQueueSize} | Retry ${runtimeMetrics.retryQueueSize}`;

  switch (state) {
    case END_SEQUENCE_STATE.INITIAL_WAIT:
      return `Starting in ${remTime}s`;
    case END_SEQUENCE_STATE.PATTERN3:
      return `Nether Wall ${fillStatus}`;
    case END_SEQUENCE_STATE.PATTERN1:
      return `Outer Clear ${fillStatus}`;
    case END_SEQUENCE_STATE.PATTERN2:
      return `Inner Clear ${fillStatus}`;
    case END_SEQUENCE_STATE.COOLDOWN:
      return `Cooldown ${remTime}s`;
    case END_SEQUENCE_STATE.COMPLETED:
      return "Game Over";
    default:
      return "Standby";
  }
}

// ======================================================
//
//                  PATTERN TASKS
//
// ======================================================

// pattern วงนอกสำหรับล้างพื้นที่ชั้นนอก
const PATTERN_1_TASK = createPatternTask(
  "pattern_1",
  MODE.CLEAR,
  [
    //  9 ≤ |x| ≤ 16 หรือ 9 ≤ |z| ≤ 16
    createPatternSegment("top", -16, 9, 16, 16),
    createPatternSegment("right", 9, -8, 16, 8),
    createPatternSegment("bottom", -16, -16, 16, -9),
    createPatternSegment("left", -16, -8, -9, 8),
  ],
  { useRotation: false, delay: 1, startTopY: WORLD_MAX_Y },
);

// pattern วงในสำหรับล้างพื้นที่ชั้นใน
const PATTERN_2_TASK = createPatternTask(
  "pattern_2",
  MODE.CLEAR,
  [
    // x[-8,8], z[-8,8] ลบ hole x[-2,1], z[-2,1]
    createPatternSegment("top", -8, 2, 8, 8),
    createPatternSegment("bottom", -8, -8, 8, -3),
    createPatternSegment("right", 2, -2, 8, 1),
    createPatternSegment("left", -8, -2, -3, 1),
  ],
  { useRotation: false, delay: 1, startTopY: WORLD_MAX_Y },
);

// pattern กำแพง nether สำหรับช่วงปิดเกม
const PATTERN_3_TASK = createPatternTask("pattern_3", MODE.NETHER, [
  createPatternSegment("top", -17, 17, 17, 17),
  createPatternSegment("right", 17, -17, 17, 17),
  createPatternSegment("bottom", -17, -17, 17, -17),
  createPatternSegment("left", -17, -17, -17, 17),
]);

// ======================================================
//
//           ---  Export API signature  ---
//
// ======================================================
// Run End Pattern 3 (รัน pattern กำแพง nether จากตำแหน่งผู้เล่นลงไปจนสุดโลก)
// ======================================================
export function runEndPattern3(player) {
  if (!player?.isValid) return;
  const dim = player.dimension;
  const startY = ~~player.location.y - 1;
  const pattern = PATTERN_3_TASK;
  for (let y = startY; y >= WORLD_MIN_Y; y--) {
    for (let i = 0; i < pattern.segments.length; i++) {
      enqueuePatternSegment(dim, pattern.segments[i], y, y, pattern.mode, DOWNWARD_Y, { randomize: true });
    }
  }
}

// กันการสั่ง pattern ซ้ำหลายครั้ง
let pattern1Queued = false;
let pattern2Queued = false;

// ======================================================
// Run End Pattern 1 (รัน pattern ล้างวงนอกจากด้านบนลงล่าง)
// ======================================================
export function runEndPattern1(player) {
  if (pattern1Queued) return;
  if (!player?.isValid) return;
  pattern1Queued = true;
  const dim = player.dimension;
  const pattern = PATTERN_1_TASK;
  for (let y = WORLD_MAX_Y; y >= WORLD_MIN_Y; y--) {
    for (let i = 0; i < pattern.segments.length; i++) {
      enqueuePatternSegment(dim, pattern.segments[i], y, y, pattern.mode, DOWNWARD_Y, pattern.fillOptions);
    }
  }
}

// ======================================================
// Run End Pattern 2 (รัน pattern ล้างวงในจากด้านล่างขึ้นบน)
// ======================================================
export function runEndPattern2(player) {
  if (pattern2Queued) return;
  if (!player?.isValid) return;
  pattern2Queued = true;
  const dim = player.dimension;
  const pattern = PATTERN_2_TASK;
  for (let y = WORLD_MIN_Y; y <= WORLD_MAX_Y; y++) {
    for (let i = 0; i < pattern.segments.length; i++) {
      enqueuePatternSegment(dim, pattern.segments[i], y, y, pattern.mode, UPWARD_Y, pattern.fillOptions);
    }
  }
}
