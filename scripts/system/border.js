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

/** ตรวจว่าผู้เล่นเป็น UHC player ที่ valid อยู่ */
function isUhcPlayer(player) {
  return ctx.isRunning && player?.isValid && isPlayerUhcId(player.id);
}

/**
 * ตรวจว่า target อยู่นอก Global Border (ทุกคน รวม non-UHC)
 * Admin ยกเว้น
 */
function isOutsideGlobalLimit(target, player) {
  if (player?.isValid && player.hasTag("admin")) return false;

  const bx = target?.x ?? target?.location?.x;
  const bz = target?.z ?? target?.location?.z;

  if (bx !== undefined && bz !== undefined) {
    return Math.abs(bx) > GLOBAL_BORDER_LIMIT || Math.abs(bz) > GLOBAL_BORDER_LIMIT;
  }
  return false;
}

/** ตรวจว่าต้อง cancel เพราะอยู่นอก shrinking border */
function shouldCancelBorderAction(player, target) {
  if (!ctx.isRunning || !ctx.wbBounds || !target) return false;

  const bx = target.x ?? target.location?.x;
  const bz = target.z ?? target.location?.z;

  if (bx !== undefined && bz !== undefined && borderManagerIsOutside(bx, bz)) {
    return isUhcPlayer(player);
  }
  return false;
}

/** Handler รวม: คืน true ถ้า event ถูก cancel */
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

// Event Subscriptions

world.beforeEvents.playerPlaceBlock.subscribe((ev) => {
  if (handleBorderAction(ev, ev.block)) return;
  if (ctx.isRunning && ctx.borderRadius <= PLACE_BLOCK_LOCK_RADIUS && isUhcPlayer(ev.player)) {
    ev.cancel = true;
  }
});

world.beforeEvents.playerInteractWithEntity.subscribe((ev) => handleBorderAction(ev, ev.target));
world.beforeEvents.playerInteractWithBlock.subscribe((ev) => handleBorderAction(ev, ev.block));

world.beforeEvents.chatSend.subscribe((ev) => {
  const player = ev.sender;
  if (!player?.isValid) return;
  if (!player.hasTag("admin")) return;
  if (ev.message !== FORCE_FILL_COMMAND) return;

  ev.cancel = true;
  system.run(() => forceFinalShrink(player));
});

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

export { endGameUhc, markAliveTeamDirty, resetGameUhc, startGameUhc };
