import { createDotEnvConfigComponent } from '@well-known-components/env-config-provider'
import {
  createServerComponent,
  createStatusCheckComponent,
  instrumentHttpServerWithPromClientRegistry
} from '@well-known-components/http-server'
import { createLogComponent } from '@well-known-components/logger'
import { createMetricsComponent } from '@well-known-components/metrics'
import { AppComponents, GlobalContext } from './types'
import { metricDeclarations } from './metrics'
import { createConsumerComponent } from './adapters/consumer'
import { createStorageComponent } from './adapters/storage'
import { createGodotSnapshotComponent } from './adapters/godot'
import { createSQSClient } from './adapters/sqs'
import { createFetchComponent } from '@well-known-components/fetch-component'
import { createAwsConfig } from './adapters/aws-config'
import { createEntityFetcher } from './adapters/entity-fetcher'
import { createImageProcessor } from './logic/image-processor'
import { createMessageValidator } from './logic/message-validator'
import { createQueueComponent } from './logic/queue'

// Initialize all the components of the app
export async function initComponents(): Promise<AppComponents> {
  const config = await createDotEnvConfigComponent({
    path: ['.env.default', '.env']
  })
  const logs = await createLogComponent({ config })
  const awsConfig = await createAwsConfig({ config })

  const metrics = await createMetricsComponent({ ...metricDeclarations }, { config })

  const server = await createServerComponent<GlobalContext>({ config, logs }, { cors: {} })
  await instrumentHttpServerWithPromClientRegistry({ metrics, server, config, registry: metrics.registry! })

  const statusChecks = await createStatusCheckComponent({ server, config })

  const storage = await createStorageComponent({ awsConfig, config, metrics, logs })

  const fetch = createFetchComponent()

  const godot = await createGodotSnapshotComponent({
    config,
    logs,
    metrics
  })

  const sqsClient = await createSQSClient({ awsConfig })

  const entityFetcher = await createEntityFetcher({ fetch, config })

  const imageProcessor = await createImageProcessor({
    config,
    logs,
    godot,
    storage,
    metrics
  })

  const messageValidator = createMessageValidator({ logs })

  const mainQueueUrl = await config.requireString('QUEUE_URL')
  const mainQueue = await createQueueComponent({ sqsClient }, mainQueueUrl)

  const dlQueueUrl = await config.requireString('DLQ_URL')
  const dlQueue = await createQueueComponent({ sqsClient }, dlQueueUrl)

  const consumer = await createConsumerComponent({
    config,
    logs,
    entityFetcher,
    imageProcessor,
    messageValidator,
    mainQueue,
    dlQueue,
    metrics
  })

  return {
    awsConfig,
    config,
    fetch,
    godot,
    logs,
    metrics,
    sqsClient,
    consumer,
    server,
    storage,
    statusChecks,
    entityFetcher,
    imageProcessor,
    messageValidator,
    mainQueue,
    dlQueue
  }
}
