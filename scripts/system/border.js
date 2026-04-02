import { system, world } from "@minecraft/server";

// @ts-ignore
import { getUhcPlayers, isPlayerUhcId } from "../Manager/TeamManager.js";
export { getAllPlayers, getUhcPlayers } from "../Manager/TeamManager.js";

// @ts-ignore
import { dynamicToast } from "../plugin/Util.js";

// @ts-ignore
import {
  borderColors,
  borderEnd,
  borderManagerGetShrinkDuration,
  borderManagerIsOutside,
  broadcast,
  CHECKPOINTS,
  ctx,
  endSequenceReset,
  MinecraftColor,
} from "./BorderManager.js";

// @ts-ignore
import { endGameUhc, markAliveTeamDirty, resetGameUhc, startGameUhc } from "./UhcMatchManager.js";

const GLOBAL_BORDER_LIMIT = CHECKPOINTS[0];
const PLACE_BLOCK_LOCK_RADIUS = 16;
const FORCE_FILL_COMMAND = "!fill";
const forceFinalShrinkQueue = [];
let forceFinalShrinkScheduled = false;

// ======================================================
// isUhcPlayer (ตรวจสอบว่าโปรแกรมเล่น UHC เปิดใช้งานอยู่หรือไม่))
// ======================================================
function isUhcPlayer(player) {
  if (!ctx.isRunning) return false;
  if (!player?.isValid) return false;
  return isPlayerUhcId(player.id);
}

// ======================================================
// getTargetAxis (อ่านเป้าหมาย x หรือ z ได้อย่างปลอดภั)
// ======================================================
function getTargetAxis(target, axis) {
  if (!target) return undefined;
  if (target[axis] !== undefined) return target[axis];
  if (!target.location) return undefined;
  return target.location[axis];
}

// ======================================================
// isOutsideGlobalLimit (ตรวจสอบขีดจำกัดขอบเขตที่เข้มงวด)
// ======================================================
function isOutsideGlobalLimit(target, player) {
  if (player?.isValid && player.hasTag("admin")) return false;

  const bx = getTargetAxis(target, "x");
  const bz = getTargetAxis(target, "z");
  if (bx === undefined) return false;
  if (bz === undefined) return false;

  if (Math.abs(bx) > GLOBAL_BORDER_LIMIT) return true;
  if (Math.abs(bz) > GLOBAL_BORDER_LIMIT) return true;
  return false;
}

// ======================================================
// shouldCancelBorderAction (ตรวจสอบการหดตัวของบล็อกขอบ)
// ======================================================
function shouldCancelBorderAction(player, target) {
  if (!ctx.isRunning) return false;
  if (!ctx.wbBounds) return false;
  if (!target) return false;

  const bx = getTargetAxis(target, "x");
  const bz = getTargetAxis(target, "z");
  if (bx === undefined) return false;
  if (bz === undefined) return false;
  if (!borderManagerIsOutside(bx, bz)) return false;

  return isUhcPlayer(player);
}

// ======================================================
// handleBorderAction (ยกเลิกการปิดกั้น Border)
// ======================================================
function handleBorderAction(ev, target) {
  if (isOutsideGlobalLimit(target, ev.player)) {
    ev.cancel = true;
    return true;
  }

  if (shouldCancelBorderAction(ev.player, target)) {
    ev.cancel = true;
    return true;
  }

  return false;
}

// ======================================================
// shouldLockPlaceBlock (ตรวจสอบบล็อกและวางล็อคใกล้ Border สุดท้าย)
// ======================================================
function shouldLockPlaceBlock(player) {
  if (!ctx.isRunning) return false;
  if (ctx.borderRadius > PLACE_BLOCK_LOCK_RADIUS) return false;
  return isUhcPlayer(player);
}

// ======================================================
// handlePlayerPlaceBlock (ป้องกันการวางบล็อกที่ขอบเขต)
// ======================================================
function handlePlayerPlaceBlock(ev) {
  if (handleBorderAction(ev, ev.block)) return;
  if (!shouldLockPlaceBlock(ev.player)) return;
  ev.cancel = true;
}

// ======================================================
// handlePlayerInteractWithEntity (ป้องกันการโต้ตอบกับเอนทิตีที่ขอบเขต)
// ======================================================
function handlePlayerInteractWithEntity(ev) {
  handleBorderAction(ev, ev.target);
}

// ======================================================
// handlePlayerInteractWithBlock (ป้องกันการโต้ตอบกับบล็อกที่ขอบเขต)
// ======================================================
function handlePlayerInteractWithBlock(ev) {
  handleBorderAction(ev, ev.block);
}

// ======================================================
// queueForceFinalShrink (เพิ่มคิวคำขอการย่อขอบเขตขั้นสุดท้าย)
// ======================================================
function queueForceFinalShrink(player) {
  forceFinalShrinkQueue.push(player);
  if (forceFinalShrinkScheduled) return;

  forceFinalShrinkScheduled = true;
  system.run(drainForceFinalShrinkQueue);
}

// ======================================================
// drainForceFinalShrinkQueue (ประมวลผลคำขอการย่อขอบเขตขั้นสุดท้ายที่อยู่ในคิว)
// ======================================================
function drainForceFinalShrinkQueue() {
  forceFinalShrinkScheduled = false;

  while (forceFinalShrinkQueue.length > 0) {
    const player = forceFinalShrinkQueue.shift();
    if (!player?.isValid) continue;
    forceFinalShrink(player);
  }
}

// ======================================================
// handleChatSend (จัดการคำสั่งขอบเขตสำหรับแอดมิน)
// ======================================================
function handleChatSend(ev) {
  const player = ev.sender;
  if (!player?.isValid) return;
  if (!player.hasTag("admin")) return;
  if (ev.message !== FORCE_FILL_COMMAND) return;

  ev.cancel = true;
  queueForceFinalShrink(player);
}

// ======================================================
// forceFinalShrink (บังคับย่อขอบเขตขั้นสุดท้าย)
// ======================================================
function forceFinalShrink(player) {
  if (!player?.isValid) return;

  if (!ctx.isRunning) {
    player.sendMessage(MinecraftColor.red + "[Fill] Game not started yet");
    return;
  }

  if (ctx.fillCommandLocked) {
    player.sendMessage(MinecraftColor.red + "[Fill] This command has already been used");
    return;
  }

  ctx.fillCommandLocked = true;
  ctx.nextShrinkIndex = CHECKPOINTS.length;
  ctx.targetRadius = borderEnd;
  ctx.startRadius = ctx.borderRadius;
  ctx.shrinkStartTick = ctx.uhcTick;
  ctx.shrinkDuration = borderManagerGetShrinkDuration(borderEnd);
  ctx.currentBorderColor = borderColors.red;
  endSequenceReset();

  player.sendMessage(`[Fill] Border shrinking to ${borderEnd}, pattern follows`);
  broadcast(getUhcPlayers(), {
    message: dynamicToast(`Safe zone shrinking to ${borderEnd}`, "textures/blocks/barrier"),
    sound: "world_noti",
  });
}

world.beforeEvents.playerPlaceBlock.subscribe(handlePlayerPlaceBlock);
world.beforeEvents.playerInteractWithEntity.subscribe(handlePlayerInteractWithEntity);
world.beforeEvents.playerInteractWithBlock.subscribe(handlePlayerInteractWithBlock);
world.beforeEvents.chatSend.subscribe(handleChatSend);

export { endGameUhc, markAliveTeamDirty, resetGameUhc, startGameUhc };
