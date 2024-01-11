import { Entity, EntityType, Profile } from '@dcl/schemas'
import { AppComponents, ProfileFetcher } from '../types'

type Delta = Omit<Entity, 'metadata'> & { metadata: Profile; entityId: string }

type PointerChangesResponse = {
  deltas: Delta[]
  filters: {
    entityTypes: EntityType[]
    includeAuthChain: boolean
  }
  pagination: {
    moreData: boolean
    limit: number
    offset: number
    next: string
  }
}

export async function createProfileFetcher({
  fetch,
  config
}: Pick<AppComponents, 'config' | 'fetch'>): Promise<ProfileFetcher> {
  const peerUrl = await config.requireString('PEER_URL')
  async function getProfilesWithChanges(from: number) {
    const now = Date.now()
    const url = `${peerUrl}/content/pointer-changes?entityType=${EntityType.PROFILE}&from=${from}&to=${now}`
    const response = await fetch.fetch(url)

    // TODO: should be handle pagination here?
    const data: PointerChangesResponse = await response.json()
    const profiles = new Map<string, string>()
    for (const profile of data.deltas) {
      for (const address of profile.pointers) {
        profiles.set(address, profile.entityId)
      }
    }
    return { entities: Array.from(profiles.values()), timestamp: now }
  }

  return { getProfilesWithChanges }
}
