import { EntityFetcher } from '../../src/adapters/entity-fetcher'

export const createEntityFetcherMock = ({
  getEntitiesByIds = jest.fn()
}: Partial<jest.Mocked<EntityFetcher>> = {}): jest.Mocked<EntityFetcher> => {
  return {
    getEntitiesByIds
  }
}
