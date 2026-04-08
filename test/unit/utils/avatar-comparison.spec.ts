import { AvatarInfo } from '@dcl/schemas'
import { avatarsAreVisuallyEqual, canonicalAvatarKey } from '../../../src/utils/avatar-comparison'

const baseAvatar: AvatarInfo = {
  bodyShape: 'urn:decentraland:off-chain:base-avatars:BaseMale',
  eyes: { color: { r: 0.1, g: 0.2, b: 0.3 } },
  hair: { color: { r: 0.4, g: 0.5, b: 0.6 } },
  skin: { color: { r: 0.7, g: 0.8, b: 0.9 } },
  wearables: ['urn:decentraland:matic:collections-v2:hat', 'urn:decentraland:matic:collections-v2:shirt'],
  snapshots: { face256: 'bafkreiface' as any, body: 'bafkrebody' as any }
}

describe('avatar-comparison', () => {
  describe('avatarsAreVisuallyEqual', () => {
    describe('and both avatars are identical', () => {
      it('should return true', () => {
        expect(avatarsAreVisuallyEqual(baseAvatar, { ...baseAvatar })).toBe(true)
      })
    })

    describe('and wearables differ', () => {
      it('should return false when a wearable is added', () => {
        const changed: AvatarInfo = {
          ...baseAvatar,
          wearables: [...baseAvatar.wearables, 'urn:decentraland:matic:collections-v2:pants']
        }
        expect(avatarsAreVisuallyEqual(baseAvatar, changed)).toBe(false)
      })

      it('should return false when a wearable is removed', () => {
        const changed: AvatarInfo = {
          ...baseAvatar,
          wearables: [baseAvatar.wearables[0]]
        }
        expect(avatarsAreVisuallyEqual(baseAvatar, changed)).toBe(false)
      })

      it('should return false when a wearable is replaced', () => {
        const changed: AvatarInfo = {
          ...baseAvatar,
          wearables: ['urn:decentraland:matic:collections-v2:different-hat', baseAvatar.wearables[1]]
        }
        expect(avatarsAreVisuallyEqual(baseAvatar, changed)).toBe(false)
      })
    })

    describe('and wearables are in a different order', () => {
      it('should return true (order-independent comparison)', () => {
        const reordered: AvatarInfo = {
          ...baseAvatar,
          wearables: [...baseAvatar.wearables].reverse()
        }
        expect(avatarsAreVisuallyEqual(baseAvatar, reordered)).toBe(true)
      })
    })

    describe('and wearables differ only in case', () => {
      it('should return true (case-insensitive comparison)', () => {
        const upperCased: AvatarInfo = {
          ...baseAvatar,
          wearables: baseAvatar.wearables.map((w) => w.toUpperCase())
        }
        expect(avatarsAreVisuallyEqual(baseAvatar, upperCased)).toBe(true)
      })
    })

    describe('and bodyShape differs', () => {
      it('should return false', () => {
        const changed: AvatarInfo = {
          ...baseAvatar,
          bodyShape: 'urn:decentraland:off-chain:base-avatars:BaseFemale'
        }
        expect(avatarsAreVisuallyEqual(baseAvatar, changed)).toBe(false)
      })

      it('should return true when bodyShape differs only in case', () => {
        const upperCased: AvatarInfo = {
          ...baseAvatar,
          bodyShape: baseAvatar.bodyShape.toUpperCase()
        }
        expect(avatarsAreVisuallyEqual(baseAvatar, upperCased)).toBe(true)
      })
    })

    describe('and eye color differs', () => {
      it('should return false', () => {
        const changed: AvatarInfo = {
          ...baseAvatar,
          eyes: { color: { r: 0.9, g: 0.2, b: 0.3 } }
        }
        expect(avatarsAreVisuallyEqual(baseAvatar, changed)).toBe(false)
      })
    })

    describe('and hair color differs', () => {
      it('should return false', () => {
        const changed: AvatarInfo = {
          ...baseAvatar,
          hair: { color: { r: 0.9, g: 0.5, b: 0.6 } }
        }
        expect(avatarsAreVisuallyEqual(baseAvatar, changed)).toBe(false)
      })
    })

    describe('and skin color differs', () => {
      it('should return false', () => {
        const changed: AvatarInfo = {
          ...baseAvatar,
          skin: { color: { r: 0.9, g: 0.8, b: 0.9 } }
        }
        expect(avatarsAreVisuallyEqual(baseAvatar, changed)).toBe(false)
      })
    })

    describe('and color values differ only beyond 4 decimal places (float noise)', () => {
      it('should return true', () => {
        const almostSame: AvatarInfo = {
          ...baseAvatar,
          eyes: { color: { r: 0.10001, g: 0.20001, b: 0.30001 } }
        }
        expect(avatarsAreVisuallyEqual(baseAvatar, almostSame)).toBe(true)
      })
    })

    describe('and forceRender differs', () => {
      it('should return false when forceRender is added', () => {
        const changed: AvatarInfo = {
          ...baseAvatar,
          forceRender: ['helmet' as any]
        }
        expect(avatarsAreVisuallyEqual(baseAvatar, changed)).toBe(false)
      })

      it('should return false when forceRender content changes', () => {
        const a: AvatarInfo = { ...baseAvatar, forceRender: ['helmet' as any] }
        const b: AvatarInfo = { ...baseAvatar, forceRender: ['mask' as any] }
        expect(avatarsAreVisuallyEqual(a, b)).toBe(false)
      })

      it('should return true when forceRender is same but reordered', () => {
        const a: AvatarInfo = { ...baseAvatar, forceRender: ['helmet' as any, 'mask' as any] }
        const b: AvatarInfo = { ...baseAvatar, forceRender: ['mask' as any, 'helmet' as any] }
        expect(avatarsAreVisuallyEqual(a, b)).toBe(true)
      })

      it('should return true when forceRender is same but different case', () => {
        const a: AvatarInfo = { ...baseAvatar, forceRender: ['Helmet' as any] }
        const b: AvatarInfo = { ...baseAvatar, forceRender: ['helmet' as any] }
        expect(avatarsAreVisuallyEqual(a, b)).toBe(true)
      })
    })

    describe('and snapshots differ (non-visual field)', () => {
      it('should return true (snapshots are excluded from comparison)', () => {
        const differentSnapshot: AvatarInfo = {
          ...baseAvatar,
          snapshots: { face256: 'bafkreidifferentface' as any, body: 'bafkreidifferentbody' as any }
        }
        expect(avatarsAreVisuallyEqual(baseAvatar, differentSnapshot)).toBe(true)
      })
    })

    describe('and wearables is null or undefined', () => {
      it('should handle null wearables gracefully', () => {
        const nullWearables: AvatarInfo = { ...baseAvatar, wearables: null as any }
        const emptyWearables: AvatarInfo = { ...baseAvatar, wearables: [] }
        expect(avatarsAreVisuallyEqual(nullWearables, emptyWearables)).toBe(true)
      })

      it('should handle undefined wearables gracefully', () => {
        const undefinedWearables: AvatarInfo = { ...baseAvatar, wearables: undefined as any }
        const emptyWearables: AvatarInfo = { ...baseAvatar, wearables: [] }
        expect(avatarsAreVisuallyEqual(undefinedWearables, emptyWearables)).toBe(true)
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
