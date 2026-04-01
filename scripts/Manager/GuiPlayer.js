import { world, system } from "@minecraft/server";
import { ActionFormData } from "@minecraft/server-ui";

import { dynamicToast } from "../plugin/Util";
import { getPlayerTeamRT, joinTeamRT, leaveTeamRT } from "./DataHelpers";
import { TEAMS } from "./DataPlayers";

export const CONFIG = Object.freeze({
  tagAdmin: "admin",
  tagUhc: "uhc",
  objectiveName: "uhcBoard",
  displayName: "UHC",
  title: "§g§r",
});

function teleportToSpawn(player) {
  if (!player?.isValid) return;
  const dim = world.getDimension("overworld");
  const baseX = 596;
  const baseY = 123;
  const baseZ = 609;
  const spawn = {
    x: baseX + Math.floor(Math.random() * 5) - 2,
    y: baseY,
    z: baseZ + Math.floor(Math.random() * 5) - 2,
  };
  player.teleport(spawn, { dimension: dim });
  const tx = spawn.x;
  const ty = spawn.y;
  const tz = spawn.z;
  system.runTimeout(() => {
    if (!player?.isValid) return;
    player.playSound("random.enderchestopen", { volume: 0.9, pitch: 0.95 });
    try {
      dim.spawnParticle("so:light2", {
        x: tx,
        y: ty + 5,
        z: tz,
      });
    } catch {}
  }, 5);
}

function TeamMenu(player) {
  const form = new ActionFormData();
  form.title(CONFIG.title);

  const currentTeamId = getPlayerTeamRT(player);
  let currentTeam = null;
  if (currentTeamId) {
    currentTeam = TEAMS.find((t) => t.tag === currentTeamId);
  }

  let teamDisplay = "Team?";
  if (currentTeam) {
    teamDisplay = `${currentTeam.color}${currentTeam.name}`;
  }

  form.body(`§f${player.name}: ${teamDisplay}`);

  for (let i = 0; i < TEAMS.length; i++) {
    form.button(`${TEAMS[i].color}${TEAMS[i].name}`, TEAMS[i].icon);
  }

  form.button("§cLeave", "textures/ui/permissions_visitor_hand");
  form.button("§6Refresh", "textures/ui/refresh_light");
  form.button("§7Close", "textures/ui/cancel");

  form.show(player).then((res) => {
    if (!res || res.canceled) return;

    const selection = res.selection;

    // เลือกทีม
    if (selection < TEAMS.length) {
      const selectedTeam = TEAMS[selection];

      if (currentTeamId === selectedTeam.tag) {
        player.playSound("note.bassattack");
        player.sendMessage(dynamicToast("§oAlready", selectedTeam.icon));
      } else {
        joinTeamRT(player, selectedTeam.tag);
        player.playSound("random.orb");
        player.sendMessage(dynamicToast(`Joined ${selectedTeam.color}${selectedTeam.name}`, selectedTeam.icon));
      }

      return; // reopen
    }

    // Action buttons
    const actionIndex = selection - TEAMS.length;

    switch (actionIndex) {
      case 0: // Leave
        if (!currentTeamId) {
          player.playSound("note.bassattack");
          player.sendMessage(dynamicToast("§cYou have no team", "textures/ui/cancel"));
        } else {
          leaveTeamRT(player);
          player.playSound("random.break");
          player.sendMessage(dynamicToast(`§c§oLeft from ${currentTeam.color}${currentTeam.name}`, "textures/ui/permissions_visitor_hand"));
        }
        return;

      case 1: // Refresh
        system.run(() => TeamMenu(player));
        return;

      case 2: // Close
        return;
    }
  });
}

function OpenMainMenu(player) {
  const form = new ActionFormData();
  form.title(CONFIG.title);
  form.body("UHCRUN26");
  form.button("Spawn", "textures/ui/icons/icon_summer");
  form.button("Team", "textures/ui/icons/icon_multiplayer");
  form.button("Credit", "textures/ui/icons/icon_multiplayer");
  if (player.hasTag(CONFIG.tagAdmin)) {
    form.button("Admin", "textures/ui/Add-Ons_Side-Nav_Icon_24x24");
  }

  form.show(player).then((res) => {
    if (!res || res.canceled) return;
    switch (res.selection) {
      case 0:
        teleportToSpawn(player);
        break;
      case 1:
        TeamMenu(player);
        break;
      case 2:
        credit(player);
        break;
      case 3:
        if (player.hasTag(CONFIG.tagAdmin)) AdminMenu(player);
        break;
    }
  });
}

world.afterEvents.itemUse.subscribe((event) => {
  const { source, itemStack } = event;

  if (!source?.isValid) return;
  if (itemStack?.typeId !== "minecraft:compass") return;
  if (!source.hasTag(CONFIG.tagAdmin) && source.hasTag(CONFIG.tagUhc)) return;

  system.run(() => OpenMainMenu(source));
});
