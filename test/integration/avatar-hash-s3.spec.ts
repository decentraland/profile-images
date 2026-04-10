import { createStorageComponent, IStorageComponent } from '../../src/adapters/storage'
import { createConfigComponent } from '@well-known-components/env-config-provider'
import { createLogComponent } from '@well-known-components/logger'
import { createTestMetricsComponent } from '@well-known-components/metrics'
import { metricDeclarations } from '../../src/metrics'
import { computeAvatarHash } from '../../src/utils/avatar-comparison'
import { AvatarInfo } from '@dcl/schemas'
import { S3Client, DeleteObjectsCommand } from '@aws-sdk/client-s3'
import * as fs from 'fs/promises'
import * as path from 'path'
import * as os from 'os'

/**
 * Integration tests for the avatar hash storage and retrieval against real LocalStack S3.
 *
 * Run via: yarn test:integration
 * (starts LocalStack automatically, runs tests, tears down)
 */
describe('when verifying avatar hash storage and retrieval via S3 metadata', () => {
  const ENTITY_ID = 'integration-test-avatar-hash'
  const LOCALSTACK_ENDPOINT = process.env.AWS_ENDPOINT || 'http://localhost:4566'

  let storage: IStorageComponent
  let s3: S3Client
  let tmpDir: string

  const avatar: AvatarInfo = {
    bodyShape: 'urn:decentraland:off-chain:base-avatars:BaseMale',
    eyes: { color: { r: 0.23, g: 0.24, b: 0.25 } },
    hair: { color: { r: 0.56, g: 0.57, b: 0.58 } },
    skin: { color: { r: 0.78, g: 0.79, b: 0.8 } },
    wearables: [
      'urn:decentraland:off-chain:base-avatars:casual_hair_01',
      'urn:decentraland:off-chain:base-avatars:eyebrows_04',
      'urn:decentraland:off-chain:base-avatars:f_eyes_01'
    ],
    snapshots: { face256: 'bafkreiface' as any, body: 'bafkrebody' as any }
  }

  beforeAll(async () => {
    const config = createConfigComponent(
      {
        BUCKET_NAME: 'profile-images-bucket',
        S3_IMAGES_PREFIX: '',
        AWS_REGION: 'us-east-1',
        AWS_ACCESS_KEY_ID: 'test',
        AWS_SECRET_ACCESS_KEY: 'test',
        AWS_ENDPOINT: LOCALSTACK_ENDPOINT
      },
      {}
    )

    const logs = await createLogComponent({ config })
    const metrics = createTestMetricsComponent(metricDeclarations)

    const awsConfig = {
      region: 'us-east-1',
      credentials: { accessKeyId: 'test', secretAccessKey: 'test' },
      endpoint: LOCALSTACK_ENDPOINT,
      forcePathStyle: true
    }

    s3 = new S3Client(awsConfig)
    storage = await createStorageComponent({ awsConfig, config, metrics, logs })
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'profile-images-test-'))
  })

  beforeEach(async () => {
    try {
      await s3.send(
        new DeleteObjectsCommand({
          Bucket: 'profile-images-bucket',
          Delete: {
            Objects: [{ Key: `/entities/${ENTITY_ID}/body.png` }, { Key: `/entities/${ENTITY_ID}/face.png` }]
          }
        })
      )
    } catch {
      // Ignore if objects don't exist
    }
  })

  afterAll(async () => {
    if (tmpDir) await fs.rm(tmpDir, { recursive: true, force: true })
  })

  async function createDummyImages(suffix: string): Promise<{ avatarPath: string; facePath: string }> {
    const avatarPath = path.join(tmpDir, `${suffix}_body.png`)
    const facePath = path.join(tmpDir, `${suffix}_face.png`)
    await fs.writeFile(avatarPath, Buffer.from('dummy-body-png').toString('utf-8'))
    await fs.writeFile(facePath, Buffer.from('dummy-face-png').toString('utf-8'))
    return { avatarPath, facePath }
  }

  describe('and no previous image exists (first render)', () => {
    it('should return undefined from retrieveAvatarHash', async () => {
      const hash = await storage.retrieveAvatarHash(ENTITY_ID)
      expect(hash).toBeUndefined()
    })
  })

  describe('and storeImages is called with an avatar hash', () => {
    let expectedHash: string

    beforeEach(async () => {
      expectedHash = computeAvatarHash(avatar)
      const { avatarPath, facePath } = await createDummyImages(ENTITY_ID)
      const success = await storage.storeImages(ENTITY_ID, avatarPath, facePath, expectedHash)
      expect(success).toBe(true)
    })

    it('should store the hash as S3 metadata on body.png', async () => {
      const storedHash = await storage.retrieveAvatarHash(ENTITY_ID)
      expect(storedHash).toBe(expectedHash)
    })

    describe('and the same avatar is deployed again', () => {
      it('should detect the hash match (skip scenario)', async () => {
        const incomingHash = computeAvatarHash(avatar)
        const storedHash = await storage.retrieveAvatarHash(ENTITY_ID)
        expect(storedHash).toBe(incomingHash)
      })
    })

    describe('and the avatar changes wearables', () => {
      it('should detect the hash mismatch (re-render scenario)', async () => {
        const changedAvatar: AvatarInfo = {
          ...avatar,
          wearables: [
            ...avatar.wearables,
            'urn:decentraland:matic:collections-v2:0xf6f601efee04e74cecac02c8c5bdc8cc0fc1c721:0:3'
          ]
        }
        const incomingHash = computeAvatarHash(changedAvatar)
        const storedHash = await storage.retrieveAvatarHash(ENTITY_ID)
        expect(storedHash).not.toBe(incomingHash)
      })
    })

    describe('and the avatar changes eye color', () => {
      it('should detect the hash mismatch (re-render scenario)', async () => {
        const changedAvatar: AvatarInfo = { ...avatar, eyes: { color: { r: 0.99, g: 0.01, b: 0.5 } } }
        const incomingHash = computeAvatarHash(changedAvatar)
        const storedHash = await storage.retrieveAvatarHash(ENTITY_ID)
        expect(storedHash).not.toBe(incomingHash)
      })
    })

    describe('and the avatar changes body shape', () => {
      it('should detect the hash mismatch (re-render scenario)', async () => {
        const changedAvatar: AvatarInfo = {
          ...avatar,
          bodyShape: 'urn:decentraland:off-chain:base-avatars:BaseFemale'
        }
        const incomingHash = computeAvatarHash(changedAvatar)
        const storedHash = await storage.retrieveAvatarHash(ENTITY_ID)
        expect(storedHash).not.toBe(incomingHash)
      })
    })

    describe('and only non-visual fields change (emotes, snapshots)', () => {
      it('should detect the hash match (skip scenario)', async () => {
        const changedAvatar: AvatarInfo = {
          ...avatar,
          emotes: [{ slot: 0, urn: 'urn:decentraland:off-chain:base-emotes:wave' }],
          snapshots: { face256: 'bafkreidifferent' as any, body: 'bafkreidifferent' as any }
        }
        const incomingHash = computeAvatarHash(changedAvatar)
        const storedHash = await storage.retrieveAvatarHash(ENTITY_ID)
        expect(storedHash).toBe(incomingHash)
      })
    })

    describe('and a re-render overwrites the image with a new hash', () => {
      it('should return the updated hash on next retrieval', async () => {
        const changedAvatar: AvatarInfo = {
          ...avatar,
          wearables: ['urn:decentraland:off-chain:base-avatars:new-hat']
        }
        const newHash = computeAvatarHash(changedAvatar)
        const { avatarPath, facePath } = await createDummyImages(`${ENTITY_ID}-v2`)
        await storage.storeImages(ENTITY_ID, avatarPath, facePath, newHash)

        const storedHash = await storage.retrieveAvatarHash(ENTITY_ID)
        expect(storedHash).toBe(newHash)
      })
    })
  })
})
