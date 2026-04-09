import { AvatarInfo } from '@dcl/schemas'
import { computeAvatarHash, canonicalAvatarKey } from '../../../src/utils/avatar-comparison'

const baseAvatar: AvatarInfo = {
  bodyShape: 'urn:decentraland:off-chain:base-avatars:BaseMale',
  eyes: { color: { r: 0.1, g: 0.2, b: 0.3 } },
  hair: { color: { r: 0.4, g: 0.5, b: 0.6 } },
  skin: { color: { r: 0.7, g: 0.8, b: 0.9 } },
  wearables: ['urn:decentraland:matic:collections-v2:hat', 'urn:decentraland:matic:collections-v2:shirt'],
  snapshots: { face256: 'bafkreiface' as any, body: 'bafkrebody' as any }
}

describe('avatar-comparison', () => {
  describe('computeAvatarHash', () => {
    it('should return a 64-character hex string (SHA-256)', () => {
      const hash = computeAvatarHash(baseAvatar)
      expect(hash).toMatch(/^[0-9a-f]{64}$/)
    })

    it('should return the same hash for identical avatars', () => {
      expect(computeAvatarHash(baseAvatar)).toBe(computeAvatarHash({ ...baseAvatar }))
    })

    describe('and wearables differ', () => {
      it('should return different hash when a wearable is added', () => {
        const changed: AvatarInfo = {
          ...baseAvatar,
          wearables: [...baseAvatar.wearables, 'urn:decentraland:matic:collections-v2:pants']
        }
        expect(computeAvatarHash(baseAvatar)).not.toBe(computeAvatarHash(changed))
      })

      it('should return different hash when a wearable is removed', () => {
        const changed: AvatarInfo = {
          ...baseAvatar,
          wearables: [baseAvatar.wearables[0]]
        }
        expect(computeAvatarHash(baseAvatar)).not.toBe(computeAvatarHash(changed))
      })

      it('should return different hash when a wearable is replaced', () => {
        const changed: AvatarInfo = {
          ...baseAvatar,
          wearables: ['urn:decentraland:matic:collections-v2:different-hat', baseAvatar.wearables[1]]
        }
        expect(computeAvatarHash(baseAvatar)).not.toBe(computeAvatarHash(changed))
      })
    })

    describe('and wearables are in a different order', () => {
      it('should return the same hash (order-independent comparison)', () => {
        const reordered: AvatarInfo = {
          ...baseAvatar,
          wearables: [...baseAvatar.wearables].reverse()
        }
        expect(computeAvatarHash(baseAvatar)).toBe(computeAvatarHash(reordered))
      })
    })

    describe('and wearables differ only in case', () => {
      it('should return the same hash (case-insensitive comparison)', () => {
        const upperCased: AvatarInfo = {
          ...baseAvatar,
          wearables: baseAvatar.wearables.map((w) => w.toUpperCase())
        }
        expect(computeAvatarHash(baseAvatar)).toBe(computeAvatarHash(upperCased))
      })
    })

    describe('and bodyShape differs', () => {
      it('should return different hash', () => {
        const changed: AvatarInfo = {
          ...baseAvatar,
          bodyShape: 'urn:decentraland:off-chain:base-avatars:BaseFemale'
        }
        expect(computeAvatarHash(baseAvatar)).not.toBe(computeAvatarHash(changed))
      })

      it('should return same hash when bodyShape differs only in case', () => {
        const upperCased: AvatarInfo = {
          ...baseAvatar,
          bodyShape: baseAvatar.bodyShape.toUpperCase()
        }
        expect(computeAvatarHash(baseAvatar)).toBe(computeAvatarHash(upperCased))
      })
    })

    describe('and eye color differs', () => {
      it('should return different hash', () => {
        const changed: AvatarInfo = {
          ...baseAvatar,
          eyes: { color: { r: 0.9, g: 0.2, b: 0.3 } }
        }
        expect(computeAvatarHash(baseAvatar)).not.toBe(computeAvatarHash(changed))
      })
    })

    describe('and hair color differs', () => {
      it('should return different hash', () => {
        const changed: AvatarInfo = {
          ...baseAvatar,
          hair: { color: { r: 0.9, g: 0.5, b: 0.6 } }
        }
        expect(computeAvatarHash(baseAvatar)).not.toBe(computeAvatarHash(changed))
      })
    })

    describe('and skin color differs', () => {
      it('should return different hash', () => {
        const changed: AvatarInfo = {
          ...baseAvatar,
          skin: { color: { r: 0.9, g: 0.8, b: 0.9 } }
        }
        expect(computeAvatarHash(baseAvatar)).not.toBe(computeAvatarHash(changed))
      })
    })

    describe('and color values differ only beyond 4 decimal places (float noise)', () => {
      it('should return the same hash', () => {
        const almostSame: AvatarInfo = {
          ...baseAvatar,
          eyes: { color: { r: 0.10001, g: 0.20001, b: 0.30001 } }
        }
        expect(computeAvatarHash(baseAvatar)).toBe(computeAvatarHash(almostSame))
      })
    })

    describe('and forceRender differs', () => {
      it('should return different hash when forceRender is added', () => {
        const changed: AvatarInfo = {
          ...baseAvatar,
          forceRender: ['helmet' as any]
        }
        expect(computeAvatarHash(baseAvatar)).not.toBe(computeAvatarHash(changed))
      })

      it('should return different hash when forceRender content changes', () => {
        const a: AvatarInfo = { ...baseAvatar, forceRender: ['helmet' as any] }
        const b: AvatarInfo = { ...baseAvatar, forceRender: ['mask' as any] }
        expect(computeAvatarHash(a)).not.toBe(computeAvatarHash(b))
      })

      it('should return the same hash when forceRender is same but reordered', () => {
        const a: AvatarInfo = { ...baseAvatar, forceRender: ['helmet' as any, 'mask' as any] }
        const b: AvatarInfo = { ...baseAvatar, forceRender: ['mask' as any, 'helmet' as any] }
        expect(computeAvatarHash(a)).toBe(computeAvatarHash(b))
      })

      it('should return the same hash when forceRender is same but different case', () => {
        const a: AvatarInfo = { ...baseAvatar, forceRender: ['Helmet' as any] }
        const b: AvatarInfo = { ...baseAvatar, forceRender: ['helmet' as any] }
        expect(computeAvatarHash(a)).toBe(computeAvatarHash(b))
      })
    })

    describe('and snapshots differ (non-visual field)', () => {
      it('should return the same hash (snapshots are excluded from comparison)', () => {
        const differentSnapshot: AvatarInfo = {
          ...baseAvatar,
          snapshots: { face256: 'bafkreidifferentface' as any, body: 'bafkreidifferentbody' as any }
        }
        expect(computeAvatarHash(baseAvatar)).toBe(computeAvatarHash(differentSnapshot))
      })
    })

    describe('and wearables is null or undefined', () => {
      it('should handle null wearables gracefully', () => {
        const nullWearables: AvatarInfo = { ...baseAvatar, wearables: null as any }
        const emptyWearables: AvatarInfo = { ...baseAvatar, wearables: [] }
        expect(computeAvatarHash(nullWearables)).toBe(computeAvatarHash(emptyWearables))
      })

      it('should handle undefined wearables gracefully', () => {
        const undefinedWearables: AvatarInfo = { ...baseAvatar, wearables: undefined as any }
        const emptyWearables: AvatarInfo = { ...baseAvatar, wearables: [] }
        expect(computeAvatarHash(undefinedWearables)).toBe(computeAvatarHash(emptyWearables))
      })
    })
  })

  describe('canonicalAvatarKey', () => {
    it('should produce a deterministic JSON string', () => {
      const key1 = canonicalAvatarKey(baseAvatar)
      const key2 = canonicalAvatarKey({ ...baseAvatar })
      expect(key1).toBe(key2)
    })

    it('should sort wearables in the output', () => {
      const reversed: AvatarInfo = { ...baseAvatar, wearables: [...baseAvatar.wearables].reverse() }
      expect(canonicalAvatarKey(baseAvatar)).toBe(canonicalAvatarKey(reversed))
    })
  })
})
