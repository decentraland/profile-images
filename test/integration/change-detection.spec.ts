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
 * Integration tests for the change-detection optimization against real LocalStack S3.
 *
 * Prerequisites:
 *   docker compose up -d localstack
 *
 * Run:
 *   yarn test --testPathPattern=change-detection
 *
 * These tests verify that:
 * - storeImages writes avatar-hash as S3 object metadata on body.png
 * - retrieveAvatarHash reads the hash back via HeadObject
 * - The full skip/render decision works end-to-end with real S3
 */
describe('when testing change detection against LocalStack', () => {
  const ENTITY_ID = 'integration-test-change-detection'
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

    // Create temp dir for dummy images
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'profile-images-test-'))
  })

  beforeEach(async () => {
    // Clean up test entity from S3
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
    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  async function createDummyImages(entityId: string): Promise<{ avatarPath: string; facePath: string }> {
    const avatarPath = path.join(tmpDir, `${entityId}_body.png`)
    const facePath = path.join(tmpDir, `${entityId}_face.png`)
    await fs.writeFile(avatarPath, Buffer.from('dummy-body-png'))
    await fs.writeFile(facePath, Buffer.from('dummy-face-png'))
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
      let changedAvatar: AvatarInfo

      beforeEach(() => {
        changedAvatar = {
          ...avatar,
          wearables: [
            ...avatar.wearables,
            'urn:decentraland:matic:collections-v2:0xf6f601efee04e74cecac02c8c5bdc8cc0fc1c721:0:3'
          ]
        }
      })

      it('should detect the hash mismatch (re-render scenario)', async () => {
        const incomingHash = computeAvatarHash(changedAvatar)
        const storedHash = await storage.retrieveAvatarHash(ENTITY_ID)

        expect(storedHash).not.toBe(incomingHash)
      })
    })

    describe('and the avatar changes eye color', () => {
      let changedAvatar: AvatarInfo

      beforeEach(() => {
        changedAvatar = {
          ...avatar,
          eyes: { color: { r: 0.99, g: 0.01, b: 0.5 } }
        }
      })

      it('should detect the hash mismatch (re-render scenario)', async () => {
        const incomingHash = computeAvatarHash(changedAvatar)
        const storedHash = await storage.retrieveAvatarHash(ENTITY_ID)

        expect(storedHash).not.toBe(incomingHash)
      })
    })

    describe('and the avatar changes body shape', () => {
      let changedAvatar: AvatarInfo

      beforeEach(() => {
        changedAvatar = {
          ...avatar,
          bodyShape: 'urn:decentraland:off-chain:base-avatars:BaseFemale'
        }
      })

      it('should detect the hash mismatch (re-render scenario)', async () => {
        const incomingHash = computeAvatarHash(changedAvatar)
        const storedHash = await storage.retrieveAvatarHash(ENTITY_ID)

        expect(storedHash).not.toBe(incomingHash)
      })
    })

    describe('and only non-visual fields change (name, description, emotes)', () => {
      let changedAvatar: AvatarInfo

      beforeEach(() => {
        changedAvatar = {
          ...avatar,
          emotes: [{ slot: 0, urn: 'urn:decentraland:off-chain:base-emotes:wave' }],
          snapshots: { face256: 'bafkreidifferent' as any, body: 'bafkreidifferent' as any }
        }
      })

      it('should detect the hash MATCH (skip scenario — non-visual changes)', async () => {
        const incomingHash = computeAvatarHash(changedAvatar)
        const storedHash = await storage.retrieveAvatarHash(ENTITY_ID)

        expect(storedHash).toBe(incomingHash)
      })
    })

    describe('and a re-render overwrites the image with a new hash', () => {
      let newHash: string

      beforeEach(async () => {
        const changedAvatar: AvatarInfo = {
          ...avatar,
          wearables: ['urn:decentraland:off-chain:base-avatars:new-hat']
        }
        newHash = computeAvatarHash(changedAvatar)
        const { avatarPath, facePath } = await createDummyImages(`${ENTITY_ID}-v2`)
        const success = await storage.storeImages(ENTITY_ID, avatarPath, facePath, newHash)
        expect(success).toBe(true)
      })

      it('should return the updated hash on next HeadObject', async () => {
        const storedHash = await storage.retrieveAvatarHash(ENTITY_ID)

        expect(storedHash).toBe(newHash)
      })
    })
  })
})
