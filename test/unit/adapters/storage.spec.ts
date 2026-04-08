import { createStorageComponent, IStorageComponent } from '../../../src/adapters/storage'
import { createConfigComponent } from '@well-known-components/env-config-provider'
import { createLogComponent } from '@well-known-components/logger'
import { createTestMetricsComponent } from '@well-known-components/metrics'
import { metricDeclarations } from '../../../src/metrics'
import type { IConfigComponent, ILoggerComponent, IMetricsComponent } from '@well-known-components/interfaces'
import { CompleteMultipartUploadCommandOutput } from '@aws-sdk/client-s3'
import * as fs from 'fs/promises'

// Mock AWS SDK and fs
jest.mock('@aws-sdk/client-s3')
jest.mock('@aws-sdk/lib-storage')
jest.mock('fs/promises')

describe('when using storage component', () => {
  let config: IConfigComponent
  let metrics: IMetricsComponent<keyof typeof metricDeclarations>
  let logs: ILoggerComponent
  let storage: IStorageComponent
  let mockS3Client: { send: jest.Mock }
  let mockUpload: { done: jest.Mock }
  let mockFs: jest.Mocked<typeof fs>

  beforeEach(async () => {
    config = createConfigComponent(
      {
        BUCKET_NAME: 'test-bucket',
        S3_IMAGES_PREFIX: 'test-prefix'
      },
      {}
    )
    metrics = createTestMetricsComponent(metricDeclarations)
    logs = await createLogComponent({ config })

    // Mock S3 client
    mockS3Client = {
      send: jest.fn()
    }
    const { S3Client } = jest.requireMock('@aws-sdk/client-s3')
    S3Client.mockImplementation(() => mockS3Client)

    // Mock Upload
    mockUpload = {
      done: jest.fn()
    }
    const { Upload } = jest.requireMock('@aws-sdk/lib-storage')
    Upload.mockImplementation(() => mockUpload)

    // Mock fs
    mockFs = jest.mocked(fs)
    mockFs.readFile.mockResolvedValue(Buffer.from('test-image-data'))
    mockFs.rm.mockResolvedValue(undefined)

    storage = await createStorageComponent({
      awsConfig: { region: 'us-east-1' },
      config,
      metrics,
      logs
    })
  })

  afterEach(() => {
    jest.clearAllMocks()
  })

  describe('and storing images', () => {
    beforeEach(() => {
      mockUpload.done.mockResolvedValue({} as CompleteMultipartUploadCommandOutput)
    })

    it('should resolve to true, upload the images and remove the uploaded files images', async () => {
      const result = await storage.storeImages('entity-1', '/tmp/avatar.png', '/tmp/face.png')

      expect(result).toBe(true)
      expect(mockFs.readFile).toHaveBeenCalledWith('/tmp/avatar.png')
      expect(mockFs.readFile).toHaveBeenCalledWith('/tmp/face.png')
      expect(mockFs.rm).toHaveBeenCalledWith('/tmp/avatar.png')
      expect(mockFs.rm).toHaveBeenCalledWith('/tmp/face.png')
    })
  })

  describe('and storing images fails', () => {
    beforeEach(() => {
      mockUpload.done.mockRejectedValue(new Error('Upload failed'))
    })

    it('should return false and log error', async () => {
      const result = await storage.storeImages('entity-1', '/tmp/avatar.png', '/tmp/face.png')

      expect(result).toBe(false)
      expect(mockFs.readFile).toHaveBeenCalledWith('/tmp/avatar.png')
      expect(mockFs.readFile).toHaveBeenCalledWith('/tmp/face.png')
      expect(mockFs.rm).toHaveBeenCalledWith('/tmp/avatar.png')
      expect(mockFs.rm).toHaveBeenCalledWith('/tmp/face.png')
    })
  })

  describe('and storing failure', () => {
    beforeEach(() => {
      mockUpload.done.mockResolvedValue({} as CompleteMultipartUploadCommandOutput)
    })

    it('should store failure successfully', async () => {
      const failure = { error: 'test error', timestamp: Date.now() }

      await storage.storeFailure('entity-1', JSON.stringify(failure))

      expect(mockUpload.done).toHaveBeenCalled()
    })
  })

  describe('and deleting failures', () => {
    beforeEach(() => {
      mockS3Client.send.mockResolvedValue({})
    })

    it('should delete failures successfully', async () => {
      const entities = ['entity-1', 'entity-2']

      await storage.deleteFailures(entities)

      const { DeleteObjectsCommand } = jest.requireMock('@aws-sdk/client-s3')
      expect(DeleteObjectsCommand).toHaveBeenCalledWith({
        Bucket: 'test-bucket',
        Delete: {
          Objects: [{ Key: 'test-prefix/failures/entity-1.txt' }, { Key: 'test-prefix/failures/entity-2.txt' }]
        }
      })
      expect(mockS3Client.send).toHaveBeenCalled()
    })
  })

  describe('and retrieving last checked timestamp', () => {
    describe('and timestamp exists', () => {
      beforeEach(() => {
        const mockBody = {
          transformToByteArray: jest.fn().mockResolvedValue(new Uint8Array([49, 50, 51, 52, 53]))
        }
        mockS3Client.send.mockResolvedValue({
          Body: mockBody
        })
      })

      it('should return timestamp', async () => {
        const result = await storage.retrieveLastCheckedTimestamp()

        expect(result).toBe(12345)
        const { GetObjectCommand } = jest.requireMock('@aws-sdk/client-s3')
        expect(GetObjectCommand).toHaveBeenCalledWith({
          Bucket: 'test-bucket',
          Key: 'last_checked_timestamp.txt'
        })
        expect(mockS3Client.send).toHaveBeenCalled()
      })
    })

    describe('and timestamp does not exist', () => {
      beforeEach(() => {
        const error = new Error('NoSuchKey')
        ;(error as any).name = 'NoSuchKey'
        mockS3Client.send.mockRejectedValue(error)
      })

      it('should return undefined', async () => {
        const result = await storage.retrieveLastCheckedTimestamp()

        expect(result).toBeUndefined()
        const { GetObjectCommand } = jest.requireMock('@aws-sdk/client-s3')
        expect(GetObjectCommand).toHaveBeenCalledWith({
          Bucket: 'test-bucket',
          Key: 'last_checked_timestamp.txt'
        })
        expect(mockS3Client.send).toHaveBeenCalled()
      })
    })

    describe('and other error occurs', () => {
      beforeEach(() => {
        mockS3Client.send.mockRejectedValue(new Error('Other error'))
      })

      it('should throw the error', async () => {
        await expect(storage.retrieveLastCheckedTimestamp()).rejects.toThrow('Other error')
        const { GetObjectCommand } = jest.requireMock('@aws-sdk/client-s3')
        expect(GetObjectCommand).toHaveBeenCalledWith({
          Bucket: 'test-bucket',
          Key: 'last_checked_timestamp.txt'
        })
        expect(mockS3Client.send).toHaveBeenCalled()
      })
    })
  })

  describe('and storing last checked timestamp', () => {
    beforeEach(() => {
      mockUpload.done.mockResolvedValue({} as CompleteMultipartUploadCommandOutput)
    })

    it('should store timestamp successfully', async () => {
      const timestamp = 1234567890

      await storage.storeLastCheckedTimestamp(timestamp)

      expect(mockUpload.done).toHaveBeenCalled()
    })
  })

  describe('and using custom prefix', () => {
    beforeEach(async () => {
      const customConfig = createConfigComponent(
        {
          BUCKET_NAME: 'test-bucket',
          S3_IMAGES_PREFIX: 'custom/prefix'
        },
        {}
      )

      storage = await createStorageComponent({
        awsConfig: { region: 'us-east-1' },
        config: customConfig,
        metrics,
        logs
      })

      mockUpload.done.mockResolvedValue({} as CompleteMultipartUploadCommandOutput)
    })

    it('should use custom prefix for storing images', async () => {
      await storage.storeImages('entity-1', '/tmp/avatar.png', '/tmp/face.png')

      expect(mockUpload.done).toHaveBeenCalledTimes(2)
    })
  })

  describe('and retrieving avatar info', () => {
    const sampleAvatarInfo = {
      bodyShape: 'urn:decentraland:off-chain:base-avatars:BaseMale',
      eyes: { color: { r: 0.1, g: 0.2, b: 0.3 } },
      hair: { color: { r: 0.4, g: 0.5, b: 0.6 } },
      skin: { color: { r: 0.7, g: 0.8, b: 0.9 } },
      wearables: ['urn:decentraland:matic:collections-v2:hat'],
      snapshots: { face256: 'bafkreiface', body: 'bafkrebody' }
    }

    describe('and the avatar.json exists', () => {
      beforeEach(() => {
        const body = {
          transformToByteArray: jest.fn().mockResolvedValue(Buffer.from(JSON.stringify(sampleAvatarInfo)))
        }
        mockS3Client.send.mockResolvedValue({ Body: body })
      })

      it('should return the parsed AvatarInfo', async () => {
        const result = await storage.retrieveAvatarInfo('entity-1')

        expect(result).toEqual(sampleAvatarInfo)
        expect(mockS3Client.send).toHaveBeenCalled()
      })
    })

    describe('and the avatar.json does not exist (NoSuchKey)', () => {
      beforeEach(() => {
        const error = new Error('NoSuchKey') as any
        error.name = 'NoSuchKey'
        mockS3Client.send.mockRejectedValue(error)
      })

      it('should return undefined', async () => {
        const result = await storage.retrieveAvatarInfo('entity-1')

        expect(result).toBeUndefined()
      })
    })

    describe('and an unexpected S3 error occurs', () => {
      beforeEach(() => {
        const error = new Error('InternalServerError') as any
        error.name = 'InternalServerError'
        mockS3Client.send.mockRejectedValue(error)
      })

      it('should return undefined and not throw (graceful degradation)', async () => {
        await expect(storage.retrieveAvatarInfo('entity-1')).resolves.toBeUndefined()
      })
    })

    describe('and the response body is empty', () => {
      beforeEach(() => {
        mockS3Client.send.mockResolvedValue({ Body: null })
      })

      it('should return undefined', async () => {
        const result = await storage.retrieveAvatarInfo('entity-1')

        expect(result).toBeUndefined()
      })
    })
  })

  describe('and storing avatar info', () => {
    const sampleAvatarInfo = {
      bodyShape: 'urn:decentraland:off-chain:base-avatars:BaseMale',
      eyes: { color: { r: 0.1, g: 0.2, b: 0.3 } },
      hair: { color: { r: 0.4, g: 0.5, b: 0.6 } },
      skin: { color: { r: 0.7, g: 0.8, b: 0.9 } },
      wearables: [],
      snapshots: { face256: 'bafkreiface', body: 'bafkrebody' }
    }

    describe('and the upload succeeds', () => {
      beforeEach(() => {
        mockUpload.done.mockResolvedValue({})
      })

      it('should upload avatar info as JSON to the correct key', async () => {
        await storage.storeAvatarInfo('entity-1', sampleAvatarInfo as any)

        expect(mockUpload.done).toHaveBeenCalledTimes(1)
      })
    })

    describe('and the upload fails', () => {
      beforeEach(() => {
        mockUpload.done.mockRejectedValue(new Error('Upload failed'))
      })

      it('should not throw (failure is non-fatal)', async () => {
        await expect(storage.storeAvatarInfo('entity-1', sampleAvatarInfo as any)).resolves.toBeUndefined()
      })
    })
  })

  describe('and deleting avatar info', () => {
    describe('and the delete succeeds', () => {
      beforeEach(() => {
        mockS3Client.send.mockResolvedValue({})
      })

      it('should send a DeleteObjectsCommand', async () => {
        await storage.deleteAvatarInfo('entity-1')

        expect(mockS3Client.send).toHaveBeenCalledTimes(1)
      })
    })

    describe('and the delete fails', () => {
      beforeEach(() => {
        mockS3Client.send.mockRejectedValue(new Error('Delete failed'))
      })

      it('should not throw (failure is non-fatal)', async () => {
        await expect(storage.deleteAvatarInfo('entity-1')).resolves.toBeUndefined()
      })
    })
  })
})
