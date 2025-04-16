import { createEntityFetcher } from '../../../src/adapters/entity-fetcher'
import { Entity, EntityType } from '@dcl/schemas'
import { createConfigComponent } from '@well-known-components/env-config-provider'
import * as catalystClient from 'dcl-catalyst-client'
import * as contractSnapshots from 'dcl-catalyst-client/dist/contracts-snapshots'

jest.mock('dcl-catalyst-client')
jest.mock('dcl-catalyst-client/dist/contracts-snapshots')

const PEER_URL = 'https://peer.decentraland.org'
const ENV = 'test'

describe('EntityFetcher', () => {
  const fetch = {
    fetch: jest.fn()
  }

  const config = createConfigComponent({ PEER_URL, ENV }, {})

  const mockEntity: Entity = {
    id: 'test-entity',
    type: EntityType.PROFILE,
    version: 'v3',
    timestamp: 1234567890,
    pointers: ['0x123'],
    content: [],
    metadata: {}
  }

  beforeEach(() => {
    jest.clearAllMocks()

    const mockCatalystServers = [
      { address: 'https://peer1.decentraland.org' },
      { address: 'https://peer2.decentraland.org' },
      { address: 'https://peer3.decentraland.org' }
    ]
    ;(contractSnapshots.getCatalystServersFromCache as jest.Mock).mockReturnValue(mockCatalystServers)
  })

  describe('getEntitiesByIds', () => {
    it('should fetch entities successfully from default content client', async () => {
      const mockContentClient = {
        fetchEntitiesByIds: jest.fn().mockResolvedValue([mockEntity])
      }
      ;(catalystClient.createContentClient as jest.Mock).mockReturnValue(mockContentClient)

      const entityFetcher = await createEntityFetcher({ fetch: fetch, config: config })
      const result = await entityFetcher.getEntitiesByIds(['test-entity'])

      expect(result).toEqual([mockEntity])
      expect(catalystClient.createContentClient).toHaveBeenCalledWith({
        fetcher: fetch,
        url: 'https://peer.decentraland.org'
      })
      expect(mockContentClient.fetchEntitiesByIds).toHaveBeenCalledWith(['test-entity'])
    })

    it('should use custom content server URL when provided', async () => {
      const mockContentClient = {
        fetchEntitiesByIds: jest.fn().mockResolvedValue([mockEntity])
      }
      ;(catalystClient.createContentClient as jest.Mock).mockReturnValue(mockContentClient)

      const entityFetcher = await createEntityFetcher({ fetch: fetch, config: config })
      await entityFetcher.getEntitiesByIds(['test-entity'], {
        contentServerUrl: 'https://custom-peer.decentraland.org'
      })

      expect(catalystClient.createContentClient).toHaveBeenCalledWith({
        fetcher: fetch,
        url: 'https://custom-peer.decentraland.org'
      })
    })

    it('should retry with different catalyst servers on failure', async () => {
      const mockContentClient1 = {
        fetchEntitiesByIds: jest.fn().mockRejectedValue(new Error('Server 1 failed'))
      }
      const mockContentClient2 = {
        fetchEntitiesByIds: jest.fn().mockResolvedValue([mockEntity])
      }

      ;(catalystClient.createContentClient as jest.Mock)
        .mockReturnValueOnce(mockContentClient1)
        .mockReturnValueOnce(mockContentClient2)

      const entityFetcher = await createEntityFetcher({ fetch: fetch, config: config })
      const result = await entityFetcher.getEntitiesByIds(['test-entity'], { retries: 3 })

      expect(result).toEqual([mockEntity])
      expect(mockContentClient1.fetchEntitiesByIds).toHaveBeenCalled()
      expect(mockContentClient2.fetchEntitiesByIds).toHaveBeenCalled()
    })

    it('should respect custom retry settings', async () => {
      const mockContentClient = {
        fetchEntitiesByIds: jest
          .fn()
          .mockRejectedValueOnce(new Error('Try 1'))
          .mockRejectedValueOnce(new Error('Try 2'))
          .mockResolvedValue([mockEntity])
      }
      ;(catalystClient.createContentClient as jest.Mock).mockReturnValue(mockContentClient)

      const entityFetcher = await createEntityFetcher({ fetch: fetch, config: config })
      const result = await entityFetcher.getEntitiesByIds(['test-entity'], {
        retries: 3,
        waitTime: 100
      })

      expect(result).toEqual([mockEntity])
      expect(mockContentClient.fetchEntitiesByIds).toHaveBeenCalledTimes(3)
    })

    it('should fail after exhausting all retries', async () => {
      const mockContentClient = {
        fetchEntitiesByIds: jest.fn().mockRejectedValue(new Error('Server error'))
      }
      ;(catalystClient.createContentClient as jest.Mock).mockReturnValue(mockContentClient)

      const entityFetcher = await createEntityFetcher({ fetch: fetch, config: config })

      await expect(entityFetcher.getEntitiesByIds(['test-entity'], { retries: 2 })).rejects.toThrow('Server error')

      expect(mockContentClient.fetchEntitiesByIds).toHaveBeenCalledTimes(2)
    })

    it('should rotate through available catalyst servers', async () => {
      const mockContentClients = [
        { fetchEntitiesByIds: jest.fn().mockRejectedValue(new Error('Server 1 failed')) },
        { fetchEntitiesByIds: jest.fn().mockRejectedValue(new Error('Server 2 failed')) },
        { fetchEntitiesByIds: jest.fn().mockResolvedValue([mockEntity]) }
      ]

      let clientIndex = 0
      ;(catalystClient.createContentClient as jest.Mock).mockImplementation(() => mockContentClients[clientIndex++])

      const entityFetcher = await createEntityFetcher({ fetch: fetch, config: config })
      const result = await entityFetcher.getEntitiesByIds(['test-entity'], { retries: 3 })

      expect(result).toEqual([mockEntity])
      expect(mockContentClients[0].fetchEntitiesByIds).toHaveBeenCalled()
      expect(mockContentClients[1].fetchEntitiesByIds).toHaveBeenCalled()
      expect(mockContentClients[2].fetchEntitiesByIds).toHaveBeenCalled()
    })

    it('should use correct network based on environment', async () => {
      const mockContentClient = {
        fetchEntitiesByIds: jest.fn().mockResolvedValue([mockEntity])
      }
      ;(catalystClient.createContentClient as jest.Mock).mockReturnValue(mockContentClient)

      const testEntityFetcher = await createEntityFetcher({ fetch, config })
      await testEntityFetcher.getEntitiesByIds(['test-entity'])
      expect(contractSnapshots.getCatalystServersFromCache).toHaveBeenCalledWith('sepolia')

      jest.clearAllMocks()
      ;(catalystClient.createContentClient as jest.Mock).mockReturnValue(mockContentClient)

      const prodConfig = createConfigComponent({ PEER_URL, ENV: 'prod' }, {})
      const prodEntityFetcher = await createEntityFetcher({ fetch, config: prodConfig })
      await prodEntityFetcher.getEntitiesByIds(['test-entity'])
      expect(contractSnapshots.getCatalystServersFromCache).toHaveBeenCalledWith('mainnet')
    })

    it('should handle empty response from content client', async () => {
      const mockContentClient = {
        fetchEntitiesByIds: jest.fn().mockResolvedValue([])
      }
      ;(catalystClient.createContentClient as jest.Mock).mockReturnValue(mockContentClient)

      const entityFetcher = await createEntityFetcher({ fetch: fetch, config: config })
      const result = await entityFetcher.getEntitiesByIds(['test-entity'])

      expect(result).toEqual([])
    })
  })
})
