import { createTestMetricsComponent } from '@well-known-components/metrics'
import { createConfigComponent } from '@well-known-components/env-config-provider'
import { createLogComponent } from '@well-known-components/logger'
import { Entity, EntityType } from '@dcl/schemas'
import { createImageProcessor } from '../../../src/logic/image-processor'
import { metricDeclarations } from '../../../src/metrics'

describe('ImageProcessor', () => {
  const COMMIT_HASH = 'abc123'
  const CURRENT_VERSION = '1.0.0'

  const config = createConfigComponent({ COMMIT_HASH, CURRENT_VERSION, LOG_LEVEL: 'OFF' }, {})

  const createMockGodot = () => ({
    generateImages: jest.fn()
  })

  const createMockStorage = () => ({
    storeImages: jest.fn(),
    storeFailure: jest.fn(),
    deleteFailures: jest.fn(),
    retrieveLastCheckedTimestamp: jest.fn(),
    storeLastCheckedTimestamp: jest.fn()
  })

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

  it('should call components correctly on successful processing', async () => {
    const logs = await createLogComponent({ config })
    const godot = createMockGodot()
    const storage = createMockStorage()
    const metrics = createTestMetricsComponent(metricDeclarations)

    const entity = createTestEntity('1')

    godot.generateImages.mockResolvedValue({
      avatars: [
        {
          entity: '1',
          success: true,
          avatarPath: 'avatar1.png',
          facePath: 'face1.png',
          avatar: entity.metadata.avatars[0].avatar
        }
      ],
      output: 'success'
    })

    storage.storeImages.mockResolvedValue(true)

    const imageProcessor = await createImageProcessor({
      config,
      logs,
      godot,
      storage,
      metrics
    })

    await imageProcessor.processEntities([entity])

    // Verify component calls
    expect(godot.generateImages).toHaveBeenCalledWith([
      {
        entity: '1',
        avatar: entity.metadata.avatars[0].avatar
      }
    ])
    expect(storage.storeImages).toHaveBeenCalledWith('1', 'avatar1.png', 'face1.png')
    expect(storage.storeFailure).not.toHaveBeenCalled()
  })

  it('should call components correctly on storage failure', async () => {
    const logs = await createLogComponent({ config })
    const godot = createMockGodot()
    const storage = createMockStorage()
    const metrics = createTestMetricsComponent(metricDeclarations)

    const entity = createTestEntity('1')

    godot.generateImages.mockResolvedValue({
      avatars: [
        {
          entity: '1',
          success: true,
          avatarPath: 'avatar1.png',
          facePath: 'face1.png',
          avatar: entity.metadata.avatars[0].avatar
        }
      ],
      output: 'success'
    })

    storage.storeImages.mockResolvedValue(false)

    const imageProcessor = await createImageProcessor({
      config,
      logs,
      godot,
      storage,
      metrics
    })

    await imageProcessor.processEntities([entity])

    // Verify component calls
    expect(godot.generateImages).toHaveBeenCalledWith([
      {
        entity: '1',
        avatar: entity.metadata.avatars[0].avatar
      }
    ])
    expect(storage.storeImages).toHaveBeenCalledWith('1', 'avatar1.png', 'face1.png')
    expect(storage.storeFailure).not.toHaveBeenCalled()
  })

  it('should call components correctly on single entity Godot failure', async () => {
    const logs = await createLogComponent({ config })
    const godot = createMockGodot()
    const storage = createMockStorage()
    const metrics = createTestMetricsComponent(metricDeclarations)

    const entity = createTestEntity('1')
    const outputGenerated = 'error: something went wrong'

    godot.generateImages.mockResolvedValue({
      avatars: [
        {
          entity: '1',
          success: false,
          avatar: entity.metadata.avatars[0].avatar
        }
      ],
      output: outputGenerated
    })

    const imageProcessor = await createImageProcessor({
      config,
      logs,
      godot,
      storage,
      metrics
    })

    await imageProcessor.processEntities([entity])

    // Verify component calls
    expect(godot.generateImages).toHaveBeenCalledWith([
      {
        entity: '1',
        avatar: entity.metadata.avatars[0].avatar
      }
    ])
    expect(storage.storeImages).not.toHaveBeenCalled()
    expect(storage.storeFailure).toHaveBeenCalledWith(
      '1',
      expect.stringMatching(
        /{"timestamp":".*","commitHash":"abc123","version":"1.0.0","entity":"1","outputGenerated":"error: something went wrong"}/
      )
    )
  })

  it('should call components correctly on batch processing with mixed results', async () => {
    const logs = await createLogComponent({ config })
    const godot = createMockGodot()
    const storage = createMockStorage()
    const metrics = createTestMetricsComponent(metricDeclarations)

    const entities = [createTestEntity('1'), createTestEntity('2')]

    godot.generateImages.mockResolvedValue({
      avatars: [
        {
          entity: '1',
          success: true,
          avatarPath: 'avatar1.png',
          facePath: 'face1.png',
          avatar: entities[0].metadata.avatars[0].avatar
        },
        {
          entity: '2',
          success: false,
          avatar: entities[1].metadata.avatars[0].avatar
        }
      ],
      output: 'partial success'
    })

    storage.storeImages.mockResolvedValue(true)

    const imageProcessor = await createImageProcessor({
      config,
      logs,
      godot,
      storage,
      metrics
    })

    await imageProcessor.processEntities(entities)

    // Verify component calls
    expect(godot.generateImages).toHaveBeenCalledWith([
      { entity: '1', avatar: entities[0].metadata.avatars[0].avatar },
      { entity: '2', avatar: entities[1].metadata.avatars[0].avatar }
    ])
    expect(storage.storeImages).toHaveBeenCalledWith('1', 'avatar1.png', 'face1.png')
    expect(storage.storeFailure).not.toHaveBeenCalled() // No failure storage in batch mode
  })

  it.each([
    { entities: null, description: 'null' },
    { entities: [], description: 'empty array' },
    { entities: undefined, description: 'undefined' }
  ])('should handle $description entities gracefully', async ({ entities }) => {
    const logs = await createLogComponent({ config })
    const godot = createMockGodot()
    const storage = createMockStorage()
    const metrics = createTestMetricsComponent(metricDeclarations)

    const imageProcessor = await createImageProcessor({
      config,
      logs,
      godot,
      storage,
      metrics
    })

    const result = await imageProcessor.processEntities(entities as any)
    expect(result).toEqual([])
    expect(godot.generateImages).not.toHaveBeenCalled()
    expect(storage.storeImages).not.toHaveBeenCalled()
    expect(storage.storeFailure).not.toHaveBeenCalled()
  })
})
