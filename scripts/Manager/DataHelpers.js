export function formatPlayerCache(cache) {
  return cache.map((p) => `${p.name} (${p.id})`);
}

export function addToCache(cache, playerId, playerName) {
  if (!cache.some((p) => p.id === playerId)) {
    cache.push({ id: playerId, name: playerName });
  }
}

export function removeFromCache(cache, playerId) {
  return cache.filter((p) => p.id !== playerId);
}
