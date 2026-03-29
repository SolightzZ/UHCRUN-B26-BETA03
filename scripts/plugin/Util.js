// Knockback
export const KB = Object.freeze({
  horizontal: 0.18,
  vertical: 0.32,
  maxHorizontal: 1.2,
});

export function clamp(v, max) {
  return v > max ? max : v < -max ? -max : v;
}

// Dynamic Toast
function padTo(text, total = 100) {
  const safe = text.length > total ? text.slice(0, total) : text;
  return safe + "\t".repeat(total - safe.length);
}

export function dynamicToast(msg = "", icon = "", bg = "textures/ui/greyBorder") {
  return "§N§O§T§I§F§I§C§A§T§I§O§N" + padTo(msg, 500) + padTo(icon, 100) + padTo(bg, 100);
}
