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

describe('when computing avatar hashes', () => {
  let hash: string

  beforeEach(() => {
    hash = computeAvatarHash(baseAvatar)
  })

  it('should return a 64-character hex string', () => {
    expect(hash).toMatch(/^[0-9a-f]{64}$/)
  })

  it('should return the same hash for identical avatars', () => {
    expect(hash).toBe(computeAvatarHash({ ...baseAvatar }))
  })

  describe('and a wearable is added', () => {
    let changedHash: string

    beforeEach(() => {
      changedHash = computeAvatarHash({
        ...baseAvatar,
        wearables: [...baseAvatar.wearables, 'urn:decentraland:matic:collections-v2:pants']
      })
    })

    it('should return a different hash', () => {
      expect(changedHash).not.toBe(hash)
    })
  })

  describe('and a wearable is removed', () => {
    let changedHash: string

    beforeEach(() => {
      changedHash = computeAvatarHash({
        ...baseAvatar,
        wearables: [baseAvatar.wearables[0]]
      })
    })

    it('should return a different hash', () => {
      expect(changedHash).not.toBe(hash)
    })
  })

  describe('and a wearable is replaced', () => {
    let changedHash: string

    beforeEach(() => {
      changedHash = computeAvatarHash({
        ...baseAvatar,
        wearables: ['urn:decentraland:matic:collections-v2:different-hat', baseAvatar.wearables[1]]
      })
    })

    it('should return a different hash', () => {
      expect(changedHash).not.toBe(hash)
    })
  })

  describe('and wearables are in a different order', () => {
    let reorderedHash: string

    beforeEach(() => {
      reorderedHash = computeAvatarHash({
        ...baseAvatar,
        wearables: [...baseAvatar.wearables].reverse()
      })
    })

    it('should return the same hash', () => {
      expect(reorderedHash).toBe(hash)
    })
  })

  describe('and wearables differ only in case', () => {
    let upperCasedHash: string

    beforeEach(() => {
      upperCasedHash = computeAvatarHash({
        ...baseAvatar,
        wearables: baseAvatar.wearables.map((w) => w.toUpperCase())
      })
    })

    it('should return the same hash', () => {
      expect(upperCasedHash).toBe(hash)
    })
  })

  describe('and bodyShape differs', () => {
    let changedHash: string

    beforeEach(() => {
      changedHash = computeAvatarHash({
        ...baseAvatar,
        bodyShape: 'urn:decentraland:off-chain:base-avatars:BaseFemale'
      })
    })

    it('should return a different hash', () => {
      expect(changedHash).not.toBe(hash)
    })
  })

  describe('and bodyShape differs only in case', () => {
    let upperCasedHash: string

    beforeEach(() => {
      upperCasedHash = computeAvatarHash({
        ...baseAvatar,
        bodyShape: baseAvatar.bodyShape.toUpperCase()
      })
    })

    it('should return the same hash', () => {
      expect(upperCasedHash).toBe(hash)
    })
  })

  describe('and eye color differs', () => {
    let changedHash: string

    beforeEach(() => {
      changedHash = computeAvatarHash({
        ...baseAvatar,
        eyes: { color: { r: 0.9, g: 0.2, b: 0.3 } }
      })
    })

    it('should return a different hash', () => {
      expect(changedHash).not.toBe(hash)
    })
  })

  describe('and hair color differs', () => {
    let changedHash: string

    beforeEach(() => {
      changedHash = computeAvatarHash({
        ...baseAvatar,
        hair: { color: { r: 0.9, g: 0.5, b: 0.6 } }
      })
    })

    it('should return a different hash', () => {
      expect(changedHash).not.toBe(hash)
    })
  })

  describe('and skin color differs', () => {
    let changedHash: string

    beforeEach(() => {
      changedHash = computeAvatarHash({
        ...baseAvatar,
        skin: { color: { r: 0.9, g: 0.8, b: 0.9 } }
      })
    })

    it('should return a different hash', () => {
      expect(changedHash).not.toBe(hash)
    })
  })

  describe('and color values differ only beyond 4 decimal places', () => {
    let almostSameHash: string

    beforeEach(() => {
      almostSameHash = computeAvatarHash({
        ...baseAvatar,
        eyes: { color: { r: 0.10001, g: 0.20001, b: 0.30001 } }
      })
    })

    it('should return the same hash', () => {
      expect(almostSameHash).toBe(hash)
    })
  })

  describe('and forceRender is added', () => {
    let changedHash: string

    beforeEach(() => {
      changedHash = computeAvatarHash({
        ...baseAvatar,
        forceRender: ['helmet' as any]
      })
    })

    it('should return a different hash', () => {
      expect(changedHash).not.toBe(hash)
    })
  })

  describe('and forceRender content changes', () => {
    let hashA: string
    let hashB: string

    beforeEach(() => {
      hashA = computeAvatarHash({ ...baseAvatar, forceRender: ['helmet' as any] })
      hashB = computeAvatarHash({ ...baseAvatar, forceRender: ['mask' as any] })
    })

    it('should return different hashes', () => {
      expect(hashA).not.toBe(hashB)
    })
  })

  describe('and forceRender is the same but reordered', () => {
    let hashA: string
    let hashB: string

    beforeEach(() => {
      hashA = computeAvatarHash({ ...baseAvatar, forceRender: ['helmet' as any, 'mask' as any] })
      hashB = computeAvatarHash({ ...baseAvatar, forceRender: ['mask' as any, 'helmet' as any] })
    })

    it('should return the same hash', () => {
      expect(hashA).toBe(hashB)
    })
  })

  describe('and forceRender is the same but different case', () => {
    let hashA: string
    let hashB: string

    beforeEach(() => {
      hashA = computeAvatarHash({ ...baseAvatar, forceRender: ['Helmet' as any] })
      hashB = computeAvatarHash({ ...baseAvatar, forceRender: ['helmet' as any] })
    })

    it('should return the same hash', () => {
      expect(hashA).toBe(hashB)
    })
  })

  describe('and snapshots differ', () => {
    let changedHash: string

    beforeEach(() => {
      changedHash = computeAvatarHash({
        ...baseAvatar,
        snapshots: { face256: 'bafkreidifferentface' as any, body: 'bafkreidifferentbody' as any }
      })
    })

    it('should return the same hash', () => {
      expect(changedHash).toBe(hash)
    })
  })

  describe('and wearables is null', () => {
    let nullHash: string
    let emptyHash: string

    beforeEach(() => {
      nullHash = computeAvatarHash({ ...baseAvatar, wearables: null as any })
      emptyHash = computeAvatarHash({ ...baseAvatar, wearables: [] })
    })

    it('should treat null as empty array', () => {
      expect(nullHash).toBe(emptyHash)
    })
  })

  describe('and wearables is undefined', () => {
    let undefinedHash: string
    let emptyHash: string

    beforeEach(() => {
      undefinedHash = computeAvatarHash({ ...baseAvatar, wearables: undefined as any })
      emptyHash = computeAvatarHash({ ...baseAvatar, wearables: [] })
    })

    it('should treat undefined as empty array', () => {
      expect(undefinedHash).toBe(emptyHash)
    })
  })
})

describe('when building canonical avatar keys', () => {
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
