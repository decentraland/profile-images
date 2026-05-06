import { createHash } from 'crypto'
import { AvatarInfo } from '@dcl/schemas'

const PRECISION = 4

function roundColor(value: number): number {
  return parseFloat(value.toFixed(PRECISION))
}

/**
 * Produces a canonical, deterministic string from the visually-relevant fields of an AvatarInfo.
 * Fields included: bodyShape, wearables (sorted, lowercased), forceRender (sorted, lowercased),
 * eyes/hair/skin colors (rounded to 4 decimal places).
 * Snapshot and emote fields are intentionally excluded — they do not affect visual appearance.
 */
export function canonicalAvatarKey(avatar: AvatarInfo): string {
  const wearables = (avatar.wearables ?? []).map((w) => w.toLowerCase()).sort()

  const forceRender = (avatar.forceRender ?? []).map((f) => f.toLowerCase()).sort()

  const canonical = {
    bodyShape: (avatar.bodyShape ?? '').toLowerCase(),
    wearables,
    forceRender,
    eyes: {
      r: roundColor(avatar.eyes?.color?.r ?? 0),
      g: roundColor(avatar.eyes?.color?.g ?? 0),
      b: roundColor(avatar.eyes?.color?.b ?? 0)
    },
    hair: {
      r: roundColor(avatar.hair?.color?.r ?? 0),
      g: roundColor(avatar.hair?.color?.g ?? 0),
      b: roundColor(avatar.hair?.color?.b ?? 0)
    },
    skin: {
      r: roundColor(avatar.skin?.color?.r ?? 0),
      g: roundColor(avatar.skin?.color?.g ?? 0),
      b: roundColor(avatar.skin?.color?.b ?? 0)
    }
  }

  return JSON.stringify(canonical)
}

/**
 * Computes a SHA-256 hash of the visually-relevant fields of an AvatarInfo.
 * Used for content-addressed change detection: if the hash matches a previously
 * stored hash, the avatar's rendered appearance has not changed.
 */
export function computeAvatarHash(avatar: AvatarInfo): string {
  return createHash('sha256').update(canonicalAvatarKey(avatar)).digest('hex')
}
