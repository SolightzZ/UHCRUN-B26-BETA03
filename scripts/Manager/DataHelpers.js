import { RuntimeStore, updateWorldProperty } from "./DataPlayers";

// ==========================
// CACHE SYSTEM DataPlayer.js
// ==========================

// แปลง cache เป็น string เพื่อ debug (name + id)
export function formatPlayerCache(cache) {
  return cache.map((p) => `${p.name} (${p.id})`);
}

// เพิ่ม player ลง cache ถ้ายังไม่มี id นี้
export function addToCache(cache, playerId, playerName) {
  if (!cache.some((p) => p.id === playerId)) {
    cache.push({ id: playerId, name: playerName });
  }
}

// ลบ player ออกจาก cache (return array ใหม่)
export function removeFromCache(cache, playerId) {
  return cache.filter((p) => p.id !== playerId);
}

// ==========================
// TEAM TAG SYNC GuiPlayer.js
// ==========================

// sync tag ของ player ให้มี team เดียว
export function syncPlayerTeamTag(player, teamId) {
  if (!player) return;
  if (!player.isValid) return;

  let tags;

  try {
    tags = player.getTags();
  } catch (e) {
    console.warn("[TAG] getTags error:", e);
    return;
  }

  // ===== remove old =====
  for (let i = 0; i < tags.length; i++) {
    const tag = tags[i];

    if (tag.startsWith("team")) {
      if (teamId) {
        if (tag !== teamId) {
          try {
            player.removeTag(tag);
          } catch (e) {
            console.warn("[TAG] remove error:", e);
          }
        }
      } else {
        try {
          player.removeTag(tag);
        } catch (e) {
          console.warn("[TAG] remove error:", e);
        }
      }
    }
  }

  // ===== add new =====
  if (teamId) {
    let latestTags;

    try {
      latestTags = player.getTags();
    } catch (e) {
      console.warn("[TAG] re-get error:", e);
      return;
    }

    if (!latestTags.includes(teamId)) {
      try {
        player.addTag(teamId);
      } catch (e) {
        console.warn("[TAG] add error:", e);
      }
    }
  }
}

// ==========================
// RUNTIME TEAM SYSTEM GuiPlayer.js
// ==========================

// set team ให้ player (ทั้ง Runtime + World + Tag)
export function setPlayerTeamRT(player, teamId) {
  if (!player) return;
  if (!player.isValid) return;

  let finalTeamId = null;

  if (teamId && teamId !== "") {
    finalTeamId = teamId;
  } else {
    finalTeamId = null;
  }

  // ===== Runtime =====
  try {
    if (finalTeamId) {
      RuntimeStore.set(player.id, "teamId", finalTeamId);
    } else {
      RuntimeStore.delete(player.id, "teamId");
    }
  } catch (e) {
    console.warn("[TEAM][Runtime] error:", e);
  }

  // ===== World =====
  try {
    updateWorldProperty(player.id, {
      teamId: finalTeamId,
    });
  } catch (e) {
    console.warn("[TEAM][World] error:", e);
  }

  // ===== Tag =====
  try {
    syncPlayerTeamTag(player, finalTeamId);
  } catch (e) {
    console.warn("[TEAM][Tag] error:", e);
  }

  // ===== Verify (กัน desync) =====
  system.runTimeout(() => {
    if (!player) return;
    if (!player.isValid) return;

    const rt = RuntimeStore.get(player.id, "teamId", null);
    const tags = player.getTags();

    if (rt !== finalTeamId) {
      console.warn("[DESYNC][Runtime]", player.name);
    }

    if (finalTeamId) {
      if (!tags.includes(finalTeamId)) {
        console.warn("[DESYNC][Tag missing]", player.name);
      }
    } else {
      for (let i = 0; i < tags.length; i++) {
        const t = tags[i];
        if (t.startsWith("team")) {
          console.warn("[DESYNC][Tag not cleared]", player.name);
          break;
        }
      }
    }
  }, 1);
}

// ดึง team จาก RuntimeStore
export function getPlayerTeamRT(player) {
  if (!player?.isValid) return null;
  return RuntimeStore.get(player.id, "teamId", null);
}

// เข้าทีม
export function joinTeamRT(player, teamId) {
  if (!player) return;
  if (!player.isValid) return;

  if (!teamId) return;

  setPlayerTeamRT(player, teamId);
}

// ออกจากทีม
export function leaveTeamRT(player) {
  if (!player) return;
  if (!player.isValid) return;

  setPlayerTeamRT(player, null);
}
