import { createConfigComponent } from '@well-known-components/env-config-provider'
import { createLogComponent } from '@well-known-components/logger'
import { IStorageComponent } from '../src/types'
import { SQSClient } from '../src/adapters/sqs'
import { createProducerComponent } from '../src/adapters/producer'

const QUEUE_NAME = 'main-queue'

describe('Producer test', function () {
  const config = createConfigComponent({ QUEUE_NAME, INTERVAL: '1000', PEER_URL: 'https://peer.decentraland.org' }, {})

  it('poll: server is not syncing', async () => {
    const logs = await createLogComponent({ config })

    const receiveMessages = jest.fn()
    const sqsClient: SQSClient = {
      receiveMessages
    } as any

    const fetch = jest.fn(async (url) => {
      if (url === 'https://peer.decentraland.org/content/status') {
        return {
          json: () => ({ synchronizationStatus: { synchronizationState: 'Bootstrapping' } })
        } as any
      }
    })
    const storage: IStorageComponent = {} as any
    const producer = await createProducerComponent({ config, logs, sqsClient, storage, fetch: { fetch } })

    const lastRun = Date.now() - 5000

    const to = await producer.poll(lastRun)
    expect(to).toEqual(lastRun)
  })
})
