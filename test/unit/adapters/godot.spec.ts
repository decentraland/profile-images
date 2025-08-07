import { createTestMetricsComponent } from '@well-known-components/metrics'
import { createConfigComponent } from '@well-known-components/env-config-provider'
import { createLogComponent } from '@well-known-components/logger'
import { ExtendedAvatar } from '../../../src/types'
import { createGodotSnapshotComponent, GodotComponent } from '../../../src/adapters/godot'
import { metricDeclarations } from '../../../src/metrics'
import { exec } from 'child_process'
import { stat, writeFile, mkdir, rm } from 'fs/promises'
import { EventEmitter } from 'events'
import { IConfigComponent, ILoggerComponent, IMetricsComponent } from '@well-known-components/interfaces'

jest.mock('child_process')
jest.mock('fs/promises')

describe('when generating images with Godot', () => {
  let config: IConfigComponent
  let metrics: IMetricsComponent<keyof typeof metricDeclarations>
  let logs: ILoggerComponent
  let godot: GodotComponent
  let testAvatars: ExtendedAvatar[]

  let mockExec: jest.Mock
  let mockChildProcess: EventEmitter

  beforeEach(async () => {
    ;(mkdir as jest.Mock).mockResolvedValue(undefined)
    ;(writeFile as jest.Mock).mockResolvedValue(undefined)
    ;(rm as jest.Mock).mockResolvedValue(undefined)

    config = createConfigComponent(
      { PEER_URL: 'http://peer', GODOT_BASE_TIMEOUT: '1000', GODOT_AVATAR_TIMEOUT: '1000' },
      {}
    )

    metrics = createTestMetricsComponent(metricDeclarations)

    logs = await createLogComponent({ config })
    godot = await createGodotSnapshotComponent({ logs, metrics, config })
    testAvatars = [
      {
        entity: 'entity1',
        avatar: {} as any
      }
    ]

    mockExec = exec as unknown as jest.Mock
    mockChildProcess = new EventEmitter()
  })

  afterEach(() => {
    jest.resetAllMocks()
  })

  describe('and process succeeds', () => {
    beforeEach(() => {
      mockExec.mockImplementation((...args) => {
        const callback = args.find((arg) => typeof arg === 'function')
        callback(null, 'success', '')
        return mockChildProcess
      })
      ;(stat as jest.Mock).mockResolvedValue({})
    })

    it('should generate images successfully', async () => {
      const result = await godot.generateImages(testAvatars)

      expect(result.avatars[0].success).toBe(true)
      expect(result.output).toBeUndefined()
      expect(mkdir).toHaveBeenCalledWith('output', { recursive: true })
      expect(writeFile).toHaveBeenCalled()
    })
  })

  describe('and process fails', () => {
    beforeEach(() => {
      mockExec.mockImplementation((...args) => {
        const isGodot = args.find((arg) => typeof arg === 'string' && arg.includes('godot'))
        const callback = args.find((arg) => typeof arg === 'function')
        if (isGodot) {
          callback(new Error('Process failed'), '', 'error output')
        } else {
          callback(null, 'success', '')
        }
        return mockChildProcess
      })
      ;(stat as jest.Mock).mockRejectedValue(new Error('nope'))
    })

    it('should handle process errors gracefully', async () => {
      const result = await godot.generateImages(testAvatars)

      expect(result.avatars[0].success).toBe(false)
      expect(result.output).toContain('error output')
      expect(mkdir).toHaveBeenCalledWith('output', { recursive: true })
      expect(writeFile).toHaveBeenCalled()
    })
  })

  describe('and processing multiple avatars', () => {
    let multipleAvatars: ExtendedAvatar[]

    beforeEach(() => {
      mockExec.mockImplementation((...args) => {
        const callback = args.find((arg) => typeof arg === 'function')
        callback(null, 'success', '')
        return mockChildProcess
      })
      ;(stat as jest.Mock).mockResolvedValue({})

      multipleAvatars = [
        {
          entity: 'entity1',
          avatar: {} as any
        },
        {
          entity: 'entity2',
          avatar: {} as any
        }
      ]
    })

    it('should handle multiple avatars', async () => {
      const result = await godot.generateImages(multipleAvatars)

      expect(result.avatars).toHaveLength(2)
      expect(result.avatars[0].success).toBe(true)
      expect(result.avatars[1].success).toBe(true)
    })
  })

  describe('and process times out', () => {
    beforeEach(() => {
      mockExec.mockImplementation((...args) => {
        const isGodot = args.find((arg) => typeof arg === 'string' && arg.includes('godot'))
        const callback = args.find((arg) => typeof arg === 'function')
        if (isGodot) {
          // Don't call the callback to simulate timeout
          return mockChildProcess
        }
        callback(null, 'success', '')
        return mockChildProcess
      })
      ;(stat as jest.Mock).mockRejectedValue(new Error('nope'))
    })

    it('should timeout when process takes too long', async () => {
      const result = await godot.generateImages(testAvatars)

      expect(result.avatars[0].success).toBe(false)
      expect(result.output).toContain('timeout')
    }, 10_000)
  })
})
