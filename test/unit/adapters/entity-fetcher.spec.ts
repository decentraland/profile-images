import { createEntityFetcher, EntityFetcher } from '../../../src/adapters/entity-fetcher'
import { Entity, EntityType } from '@dcl/schemas'
import { createConfigComponent } from '@well-known-components/env-config-provider'
import * as catalystClient from 'dcl-catalyst-client'
import * as contractSnapshots from 'dcl-catalyst-client/dist/contracts-snapshots'
import { IConfigComponent, IFetchComponent } from '@well-known-components/interfaces'

jest.mock('dcl-catalyst-client')
jest.mock('dcl-catalyst-client/dist/contracts-snapshots')

const PEER_URL = 'https://peer.decentraland.org'
const ENV = 'test'

describe('when fetching entities by IDs', () => {
  let fetch: IFetchComponent
  let config: IConfigComponent

  let entityFetcher: EntityFetcher

  let mockEntity: Entity

  beforeEach(async () => {
    mockEntity = {
      id: 'test-entity',
      type: EntityType.PROFILE,
      version: 'v3',
      timestamp: 1234567890,
      pointers: ['0x123'],
      content: [],
      metadata: {}
    }

    const mockCatalystServers = [
      { address: 'https://peer1.decentraland.org' },
      { address: 'https://peer2.decentraland.org' },
      { address: 'https://peer3.decentraland.org' }
    ]
    ;(contractSnapshots.getCatalystServersFromCache as jest.Mock).mockReturnValue(mockCatalystServers)

    fetch = {
      fetch: jest.fn()
    }
    config = createConfigComponent({ PEER_URL, ENV }, {})

    entityFetcher = await createEntityFetcher({ fetch, config })
  })

  afterEach(() => {
    jest.clearAllMocks()
  })

  describe('and using default content client', () => {
    let mockContentClient: any

    beforeEach(() => {
      mockContentClient = {
        fetchEntitiesByIds: jest.fn().mockResolvedValue([mockEntity])
      }
      ;(catalystClient.createContentClient as jest.Mock).mockReturnValue(mockContentClient)
    })

    it('should fetch entities successfully', async () => {
      const result = await entityFetcher.getEntitiesByIds(['test-entity'])

      expect(result).toEqual([mockEntity])
      expect(catalystClient.createContentClient).toHaveBeenCalledWith({
        fetcher: fetch,
        url: 'https://peer.decentraland.org'
      })
      expect(mockContentClient.fetchEntitiesByIds).toHaveBeenCalledWith(['test-entity'])
    })
  })

  describe('and using custom content server URL', () => {
    beforeEach(() => {
      const mockContentClient = {
        fetchEntitiesByIds: jest.fn().mockResolvedValue([mockEntity])
      }
      ;(catalystClient.createContentClient as jest.Mock).mockReturnValue(mockContentClient)
    })

    it('should use the custom server URL', async () => {
      await entityFetcher.getEntitiesByIds(['test-entity'], {
        contentServerUrl: 'https://custom-peer.decentraland.org'
      })

      expect(catalystClient.createContentClient).toHaveBeenCalledWith({
        fetcher: fetch,
        url: 'https://custom-peer.decentraland.org'
      })
    })
  })

  describe('and first server fails', () => {
    let mockContentClient1: any
    let mockContentClient2: any

    beforeEach(() => {
      mockContentClient1 = {
        fetchEntitiesByIds: jest.fn().mockRejectedValue(new Error('Server 1 failed'))
      }
      mockContentClient2 = {
        fetchEntitiesByIds: jest.fn().mockResolvedValue([mockEntity])
      }
      ;(catalystClient.createContentClient as jest.Mock)
        .mockReturnValueOnce(mockContentClient1)
        .mockReturnValueOnce(mockContentClient2)
    })

    it('should retry with different catalyst server', async () => {
      const result = await entityFetcher.getEntitiesByIds(['test-entity'], { retries: 3 })

      expect(result).toEqual([mockEntity])
      expect(mockContentClient1.fetchEntitiesByIds).toHaveBeenCalled()
      expect(mockContentClient2.fetchEntitiesByIds).toHaveBeenCalled()
    })
  })

  describe('and multiple retries are needed', () => {
    let mockContentClient: any

    beforeEach(() => {
      mockContentClient = {
        fetchEntitiesByIds: jest
          .fn()
          .mockRejectedValueOnce(new Error('Try 1'))
          .mockRejectedValueOnce(new Error('Try 2'))
          .mockResolvedValue([mockEntity])
      }
      ;(catalystClient.createContentClient as jest.Mock).mockReturnValue(mockContentClient)
    })

    it('should respect custom retry settings', async () => {
      const result = await entityFetcher.getEntitiesByIds(['test-entity'], {
        retries: 3,
        waitTime: 100
      })

      expect(result).toEqual([mockEntity])
      expect(mockContentClient.fetchEntitiesByIds).toHaveBeenCalledTimes(3)
    })
  })

  describe('and all retries are exhausted', () => {
    let mockContentClient: any

    beforeEach(() => {
      mockContentClient = {
        fetchEntitiesByIds: jest.fn().mockRejectedValue(new Error('Server error'))
      }
      ;(catalystClient.createContentClient as jest.Mock).mockReturnValue(mockContentClient)
    })

    it('should fail after exhausting all retries', async () => {
      await expect(entityFetcher.getEntitiesByIds(['test-entity'], { retries: 2 })).rejects.toThrow('Server error')

      expect(mockContentClient.fetchEntitiesByIds).toHaveBeenCalledTimes(2)
    })
  })

  describe('and rotating through multiple servers', () => {
    let mockContentClients: any[]

    beforeEach(() => {
      mockContentClients = [
        { fetchEntitiesByIds: jest.fn().mockRejectedValue(new Error('Server 1 failed')) },
        { fetchEntitiesByIds: jest.fn().mockRejectedValue(new Error('Server 2 failed')) },
        { fetchEntitiesByIds: jest.fn().mockResolvedValue([mockEntity]) }
      ]

      let clientIndex = 0
      ;(catalystClient.createContentClient as jest.Mock).mockImplementation(() => mockContentClients[clientIndex++])
    })

    it('should rotate through available catalyst servers', async () => {
      const result = await entityFetcher.getEntitiesByIds(['test-entity'], { retries: 3 })

      expect(result).toEqual([mockEntity])
      expect(mockContentClients[0].fetchEntitiesByIds).toHaveBeenCalled()
      expect(mockContentClients[1].fetchEntitiesByIds).toHaveBeenCalled()
      expect(mockContentClients[2].fetchEntitiesByIds).toHaveBeenCalled()
    })
  })

  describe('and using different environments', () => {
    describe('and environment is test', () => {
      let mockContentClient: any

      beforeEach(() => {
        mockContentClient = {
          fetchEntitiesByIds: jest.fn().mockResolvedValue([mockEntity])
        }
        ;(catalystClient.createContentClient as jest.Mock).mockReturnValue(mockContentClient)
      })

      it('should use sepolia network', async () => {
        await entityFetcher.getEntitiesByIds(['test-entity'])
        expect(contractSnapshots.getCatalystServersFromCache).toHaveBeenCalledWith('sepolia')
      })
    })

    describe('and environment is prod', () => {
      let mockContentClient: any

      beforeEach(() => {
        mockContentClient = {
          fetchEntitiesByIds: jest.fn().mockResolvedValue([mockEntity])
        }
        ;(catalystClient.createContentClient as jest.Mock).mockReturnValue(mockContentClient)
      })

      it('should use mainnet network', async () => {
        const prodConfig = createConfigComponent({ PEER_URL, ENV: 'prod' }, {})
        const entityFetcherWithProdConfig = await createEntityFetcher({ fetch, config: prodConfig })
        await entityFetcherWithProdConfig.getEntitiesByIds(['test-entity'])
        expect(contractSnapshots.getCatalystServersFromCache).toHaveBeenCalledWith('mainnet')
      })
    })
  })

  describe('and content client returns empty response', () => {
    let mockContentClient: any

    beforeEach(() => {
      mockContentClient = {
        fetchEntitiesByIds: jest.fn().mockResolvedValue([])
      }
      ;(catalystClient.createContentClient as jest.Mock).mockReturnValue(mockContentClient)
    })

    it('should handle empty response gracefully', async () => {
      const result = await entityFetcher.getEntitiesByIds(['test-entity'])

      expect(result).toEqual([])
    })
  })
})
