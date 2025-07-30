import { Entity } from '@dcl/schemas'
import { createContentClient, ContentClient } from 'dcl-catalyst-client'
import { getCatalystServersFromCache } from 'dcl-catalyst-client/dist/contracts-snapshots'
import { AppComponents } from '../types'
import { retry } from '../utils/retryer'
import { shuffleArray } from '../utils/array'

export type EntityFetcher = {
  getEntitiesByIds: (ids: string[], options?: Options) => Promise<Entity[]>
}

type Options = {
  retries?: number
  waitTime?: number
  contentServerUrl?: string
}

const L1_MAINNET = 'mainnet'
const L1_TESTNET = 'sepolia'

export async function createEntityFetcher({
  fetch,
  config,
  logs
}: Pick<AppComponents, 'fetch' | 'config' | 'logs'>): Promise<EntityFetcher> {
  const logger = logs.getLogger('entity-fetcher')
  const peerUrl = await config.requireString('PEER_URL')
  const contractNetwork = (await config.getString('ENV')) === 'prod' ? L1_MAINNET : L1_TESTNET

  function getContentClientOrDefault(contentServerUrl?: string): ContentClient {
    return createContentClient({ fetcher: fetch, url: contentServerUrl ?? peerUrl })
  }

  function rotateContentServerClient<T>(
    executeClientRequest: (client: ContentClient) => Promise<T>,
    contentServerUrl?: string
  ) {
    const catalystServers = shuffleArray(getCatalystServersFromCache(contractNetwork)).map((server) => server.address)
    let contentClientToUse: ContentClient = getContentClientOrDefault(contentServerUrl)

    return (attempt: number): Promise<T> => {
      if (attempt > 1 && catalystServers.length > 0) {
        const [catalystServerUrl] = catalystServers.splice(attempt % catalystServers.length, 1)
        logger.info(`Rotating content server to ${catalystServerUrl}`)
        contentClientToUse = getContentClientOrDefault(`${catalystServerUrl}/content`)
      }

      return executeClientRequest(contentClientToUse)
    }
  }

  async function getEntitiesByIds(ids: string[], options: Options = {}): Promise<Entity[]> {
    const { retries = 3, waitTime = 300, contentServerUrl } = options
    const executeClientRequest = rotateContentServerClient(
      (contentClientToUse) => contentClientToUse.fetchEntitiesByIds(ids),
      contentServerUrl
    )
    const result = await retry(executeClientRequest, retries, waitTime)

    if (!result) {
      logger.warn(`No entities found for ids=${ids}`)
    }

    return result || []
  }

  return { getEntitiesByIds }
}
