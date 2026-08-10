/**
 * Generate a deterministic hue (0-359) from a string.
 * Same string always yields the same hue.
 */
export function avatarHue(name: string): number {
  let hash = 0
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash)
  }
  return Math.abs(hash) % 360
}
