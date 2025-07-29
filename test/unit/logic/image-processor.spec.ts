import { createTestMetricsComponent } from '@well-known-components/metrics'
import { createConfigComponent } from '@well-known-components/env-config-provider'
import { createLogComponent } from '@well-known-components/logger'
import { Entity, EntityType } from '@dcl/schemas'
import { createImageProcessor } from '../../../src/logic/image-processor'
import { metricDeclarations } from '../../../src/metrics'
import { createGodotMock } from '../../mocks/godot-mock'
import { createInMemoryStorage } from '../../mocks/storage-mock'

describe('when processing entities with image processor', () => {
  const COMMIT_HASH = 'abc123'
  const CURRENT_VERSION = '1.0.0'

  const config = createConfigComponent({ COMMIT_HASH, CURRENT_VERSION, LOG_LEVEL: 'OFF' }, {})
  const metrics = createTestMetricsComponent(metricDeclarations)

  let logs: any
  let godot: jest.Mocked<any>
  let storage: any
  let imageProcessor: any
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
    logs = await createLogComponent({ config })
    godot = createGodotMock()
    storage = await createInMemoryStorage({ config, logs })
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

  describe('and processing succeeds', () => {
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
    })

    it('should generate images for single entity', async () => {
      await imageProcessor.processEntities([testEntity])

      expect(godot.generateImages).toHaveBeenCalledWith([
        {
          entity: '1',
          avatar: testEntity.metadata.avatars[0].avatar
        }
      ])
    })
  })

  describe('and storage fails', () => {
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
    })

    it('should generate images for single entity', async () => {
      await imageProcessor.processEntities([testEntity])

      expect(godot.generateImages).toHaveBeenCalledWith([
        {
          entity: '1',
          avatar: testEntity.metadata.avatars[0].avatar
        }
      ])
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
    })

    it('should generate images for single entity', async () => {
      await imageProcessor.processEntities([testEntity])

      expect(godot.generateImages).toHaveBeenCalledWith([
        {
          entity: '1',
          avatar: testEntity.metadata.avatars[0].avatar
        }
      ])
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
    })

    it('should generate images for multiple entities', async () => {
      await imageProcessor.processEntities(testEntities)

      expect(godot.generateImages).toHaveBeenCalledWith([
        { entity: '1', avatar: testEntities[0].metadata.avatars[0].avatar },
        { entity: '2', avatar: testEntities[1].metadata.avatars[0].avatar }
      ])
    })
  })

  describe.each([
    { entities: null, description: 'null' },
    { entities: [], description: 'empty array' },
    { entities: undefined, description: 'undefined' }
  ])('and entities are $description', ({ entities }) => {
    it('should handle $description entities gracefully', async () => {
      const result = await imageProcessor.processEntities(entities as any)
      expect(result).toEqual([])
      expect(godot.generateImages).not.toHaveBeenCalled()
    })
  })
})
