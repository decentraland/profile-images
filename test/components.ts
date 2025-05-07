// This file is the "test-environment" analogous for src/components.ts
// Here we define the test components to be used in the testing environment

import { createLocalFetchCompoment, createRunner } from '@well-known-components/test-helpers'

import { main } from '../src/service'
import { QueueWorker, TestComponents } from '../src/types'
import { initComponents as originalInitComponents } from '../src/components'
import { createTestMetricsComponent } from '@well-known-components/metrics'
import { metricDeclarations } from '../src/metrics'
import { IStorageComponent } from '../src/adapters/storage'
import { IFetchComponent } from '@well-known-components/interfaces'
import { SqsClient } from '../src/adapters/sqs'
import { createInMemorySqs } from './mocks/sqs-mock'
import { createDotEnvConfigComponent } from '@well-known-components/env-config-provider'
import { createQueueComponent } from '../src/logic/queue'

/**
 * Behaves like Jest "describe" function, used to describe a test for a
 * use case; it creates a whole new program and components to run an
 * isolated test.
 *
 * State is persistent within the steps of the test.
 */
export const test = createRunner<TestComponents>({
  main,
  initComponents
})

async function initComponents(): Promise<TestComponents> {
  const components = await originalInitComponents()

  const config = await createDotEnvConfigComponent({
    path: ['.env.default', '.env', '.env.test']
  })

  const metrics = createTestMetricsComponent(metricDeclarations)

  const fetch: IFetchComponent = {
    fetch: jest.fn()
  }

  const storage: IStorageComponent = {
    storeImages: jest.fn(),
    storeFailure: jest.fn(),
    deleteFailures: jest.fn(),
    retrieveLastCheckedTimestamp: jest.fn(),
    storeLastCheckedTimestamp: jest.fn()
  }

  // const sqsClient: SqsClient = {
  //   sendMessage: jest.fn(),
  //   receiveMessages: jest.fn(),
  //   deleteMessage: jest.fn(),
  //   getQueueAttributes: jest.fn().mockResolvedValue({
  //     Attributes: {
  //       ApproximateNumberOfMessages: '0',
  //       ApproximateNumberOfMessagesDelayed: '0',
  //       ApproximateNumberOfMessagesNotVisible: '0'
  //     },
  //     $metadata: {}
  //   })
  // }
  const sqsClient: SqsClient = createInMemorySqs()

  const mainQueueUrl = await config.requireString('QUEUE_URL')
  const mainQueue = await createQueueComponent({ sqsClient }, mainQueueUrl)

  const dlQueueUrl = await config.requireString('DLQ_URL')
  const dlQueue = await createQueueComponent({ sqsClient }, dlQueueUrl)

  const consumer: QueueWorker = {
    poll: jest.fn(),
    processMessages: jest.fn()
  }

  return {
    ...components,
    localFetch: await createLocalFetchCompoment(config),
    consumer,
    fetch,
    metrics,
    sqsClient,
    mainQueue,
    dlQueue,
    storage
  }
}
