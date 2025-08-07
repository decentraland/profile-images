import { createTestMetricsComponent } from '@well-known-components/metrics'
import { createConfigComponent } from '@well-known-components/env-config-provider'
import { createLogComponent } from '@well-known-components/logger'
import { Entity, EntityType } from '@dcl/schemas'
import { createImageProcessor, ImageProcessor } from '../../../src/logic/image-processor'
import { metricDeclarations } from '../../../src/metrics'
import { createGodotMock } from '../../mocks/godot-mock'
import { IStorageComponent } from '../../../src/adapters/storage'
import { IConfigComponent, ILoggerComponent, IMetricsComponent } from '@well-known-components/interfaces'

describe('when processing entities with image processor', () => {
  const COMMIT_HASH = 'abc123'
  const CURRENT_VERSION = '1.0.0'

  let config: IConfigComponent
  let metrics: IMetricsComponent<keyof typeof metricDeclarations>
  let logs: ILoggerComponent
  let godot: jest.Mocked<any>
  let storage: jest.Mocked<IStorageComponent>
  let imageProcessor: ImageProcessor
  let testEntity: Entity
  let testEntities: Entity[]

  const createTestEntity = (id: string): Entity => ({
    id,
    type: EntityType.PROFILE,
    metadata: {
      avatars: [
        {
          avatar: {
            bodyShape: 'urn:decentraland:off-chain:base-avatars:BaseMale',
            eyes: { color: { r: 0.23, g: 0.24, b: 0.25 } },
            hair: { color: { r: 0.23, g: 0.24, b: 0.25 } },
            skin: { color: { r: 0.23, g: 0.24, b: 0.25 } }
          }
        }
      ]
    },
    version: 'v3',
    pointers: ['0x123'],
    timestamp: 1234567890,
    content: []
  })

  beforeEach(async () => {
    config = createConfigComponent({ COMMIT_HASH, CURRENT_VERSION, LOG_LEVEL: 'OFF' }, {})
    metrics = createTestMetricsComponent(metricDeclarations)
    logs = await createLogComponent({ config })
    godot = createGodotMock()

    // Create a proper storage mock
    storage = {
      storeImages: jest.fn(),
      storeFailure: jest.fn(),
      deleteFailures: jest.fn(),
      retrieveLastCheckedTimestamp: jest.fn(),
      storeLastCheckedTimestamp: jest.fn()
    } as jest.Mocked<IStorageComponent>

    // Mock the metrics increment method
    jest.spyOn(metrics, 'increment').mockImplementation(() => {})

    testEntity = createTestEntity('1')
    testEntities = [createTestEntity('1'), createTestEntity('2')]

    imageProcessor = await createImageProcessor({
      config,
      logs,
      godot,
      storage,
      metrics
    })
  })

  afterEach(() => {
    jest.clearAllMocks()
  })

  describe('and processing succeeds completely', () => {
    beforeEach(() => {
      godot.generateImages.mockResolvedValue({
        avatars: [
          {
            entity: '1',
            success: true,
            avatarPath: 'avatar1.png',
            facePath: 'face1.png',
            avatar: testEntity.metadata.avatars[0].avatar
          }
        ],
        output: 'success'
      })
      storage.storeImages.mockResolvedValue(true)
    })

    it('should return success result when both Godot and storage succeed', async () => {
      const result = await imageProcessor.processEntities([testEntity])

      expect(result).toHaveLength(1)
      expect(result[0]).toEqual({
        entity: '1',
        success: true,
        shouldRetry: false,
        avatar: testEntity.metadata.avatars[0].avatar
      })
      expect(godot.generateImages).toHaveBeenCalledWith([
        {
          entity: '1',
          avatar: testEntity.metadata.avatars[0].avatar
        }
      ])
      expect(storage.storeImages).toHaveBeenCalledWith('1', 'avatar1.png', 'face1.png')
    })

    it('should increment success metrics', async () => {
      await imageProcessor.processEntities([testEntity])

      expect(metrics.increment).toHaveBeenCalledWith('snapshot_generation_count', { status: 'success' }, 1)
    })
  })

  describe('and Godot succeeds but storage fails', () => {
    beforeEach(() => {
      godot.generateImages.mockResolvedValue({
        avatars: [
          {
            entity: '1',
            success: true,
            avatarPath: 'avatar1.png',
            facePath: 'face1.png',
            avatar: testEntity.metadata.avatars[0].avatar
          }
        ],
        output: 'success'
      })
      storage.storeImages.mockResolvedValue(false)
    })

    it('should return failure result with shouldRetry true when storage fails', async () => {
      const result = await imageProcessor.processEntities([testEntity])

      expect(result).toHaveLength(1)
      expect(result[0]).toEqual({
        entity: '1',
        success: false,
        shouldRetry: true,
        error: 'Failed to store images',
        avatar: testEntity.metadata.avatars[0].avatar
      })
    })
  })

  describe('and Godot fails for single entity', () => {
    beforeEach(() => {
      const outputGenerated = 'error: something went wrong'

      godot.generateImages.mockResolvedValue({
        avatars: [
          {
            entity: '1',
            success: false,
            avatar: testEntity.metadata.avatars[0].avatar
          }
        ],
        output: outputGenerated
      })
      storage.storeFailure.mockResolvedValue()
    })

    it('should return failure result with shouldRetry false and store failure for single entity', async () => {
      const result = await imageProcessor.processEntities([testEntity])

      expect(result).toHaveLength(1)
      expect(result[0]).toEqual({
        entity: '1',
        success: false,
        shouldRetry: false,
        error: 'Godot generation failed',
        avatar: testEntity.metadata.avatars[0].avatar
      })

      // Verify failure was stored
      expect(storage.storeFailure).toHaveBeenCalledWith('1', expect.stringContaining('"entity":"1"'))
    })

    it('should increment failure metrics', async () => {
      await imageProcessor.processEntities([testEntity])

      expect(metrics.increment).toHaveBeenCalledWith('snapshot_generation_count', { status: 'failure' }, 1)
    })
  })

  describe('and Godot fails for multiple entities', () => {
    beforeEach(() => {
      const outputGenerated = 'error: something went wrong'

      godot.generateImages.mockResolvedValue({
        avatars: [
          {
            entity: '1',
            success: false,
            avatar: testEntities[0].metadata.avatars[0].avatar
          },
          {
            entity: '2',
            success: false,
            avatar: testEntities[1].metadata.avatars[0].avatar
          }
        ],
        output: outputGenerated
      })
    })

    it('should return failure results with shouldRetry true for batch failures', async () => {
      const result = await imageProcessor.processEntities(testEntities)

      expect(result).toHaveLength(2)
      expect(result[0]).toEqual({
        entity: '1',
        success: false,
        shouldRetry: true,
        error: 'Godot generation failed',
        avatar: testEntities[0].metadata.avatars[0].avatar
      })
      expect(result[1]).toEqual({
        entity: '2',
        success: false,
        shouldRetry: true,
        error: 'Godot generation failed',
        avatar: testEntities[1].metadata.avatars[0].avatar
      })

      // Verify failures were not stored (should be retried individually)
      expect(storage.storeFailure).not.toHaveBeenCalled()
    })
  })

  describe('and batch processing has mixed results', () => {
    beforeEach(() => {
      godot.generateImages.mockResolvedValue({
        avatars: [
          {
            entity: '1',
            success: true,
            avatarPath: 'avatar1.png',
            facePath: 'face1.png',
            avatar: testEntities[0].metadata.avatars[0].avatar
          },
          {
            entity: '2',
            success: false,
            avatar: testEntities[1].metadata.avatars[0].avatar
          }
        ],
        output: 'partial success'
      })
      storage.storeImages.mockResolvedValue(true)
    })

    it('should return mixed results for batch processing', async () => {
      const result = await imageProcessor.processEntities(testEntities)

      expect(result).toHaveLength(2)
      expect(result[0]).toEqual({
        entity: '1',
        success: true,
        shouldRetry: false,
        avatar: testEntities[0].metadata.avatars[0].avatar
      })
      expect(result[1]).toEqual({
        entity: '2',
        success: false,
        shouldRetry: true,
        error: 'Godot generation failed',
        avatar: testEntities[1].metadata.avatars[0].avatar
      })
    })

    it('should increment metrics for both success and failure', async () => {
      await imageProcessor.processEntities(testEntities)

      expect(metrics.increment).toHaveBeenCalledWith('snapshot_generation_count', { status: 'success' }, 1)
      expect(metrics.increment).toHaveBeenCalledWith('snapshot_generation_count', { status: 'failure' }, 1)
    })
  })

  describe('and no entities are provided', () => {
    it('should return empty array and log warning', async () => {
      const result = await imageProcessor.processEntities([])

      expect(result).toEqual([])
      expect(godot.generateImages).not.toHaveBeenCalled()
    })
  })

  describe('and storage fails for one entity in batch', () => {
    beforeEach(() => {
      godot.generateImages.mockResolvedValue({
        avatars: [
          {
            entity: '1',
            success: true,
            avatarPath: 'avatar1.png',
            facePath: 'face1.png',
            avatar: testEntities[0].metadata.avatars[0].avatar
          },
          {
            entity: '2',
            success: true,
            avatarPath: 'avatar2.png',
            facePath: 'face2.png',
            avatar: testEntities[1].metadata.avatars[0].avatar
          }
        ],
        output: 'success'
      })
    })

    it('should handle mixed storage results', async () => {
      // Mock storage to fail for entity 2
      storage.storeImages
        .mockResolvedValueOnce(true) // entity 1 succeeds
        .mockResolvedValueOnce(false) // entity 2 fails

      const result = await imageProcessor.processEntities(testEntities)

      expect(result).toHaveLength(2)
      expect(result[0]).toEqual({
        entity: '1',
        success: true,
        shouldRetry: false,
        avatar: testEntities[0].metadata.avatars[0].avatar
      })
      expect(result[1]).toEqual({
        entity: '2',
        success: false,
        shouldRetry: true,
        error: 'Failed to store images',
        avatar: testEntities[1].metadata.avatars[0].avatar
      })
    })
  })
})
