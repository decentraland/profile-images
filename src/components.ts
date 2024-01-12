import { createDotEnvConfigComponent } from '@well-known-components/env-config-provider'
import { createServerComponent, createStatusCheckComponent } from '@well-known-components/http-server'
import { createLogComponent } from '@well-known-components/logger'
import { createMetricsComponent, instrumentHttpServerWithMetrics } from '@well-known-components/metrics'
import { AppComponents, AwsConfig, GlobalContext } from './types'
import { metricDeclarations } from './metrics'
import { createFetchComponent } from './adapters/fetch'
import { createConsumerComponent } from './adapters/consumer'
import { createStorageComponent } from './adapters/storage'
import { createProducerComponent } from './adapters/producer'
import { createProfileFetcher } from './adapters/profile-fetcher'
import { createGodotSnapshotComponent } from './adapters/godot'
import { createQueueComponent } from './adapters/queue'
import { createRetryConsumerComponent } from './adapters/retryConsumer'

// Initialize all the components of the app
export async function initComponents(): Promise<AppComponents> {
  const config = await createDotEnvConfigComponent({
    path: ['.env.default', '.env']
  })
  const logs = await createLogComponent({ config })

  const metrics = await createMetricsComponent({ ...metricDeclarations }, { config })

  const server = await createServerComponent<GlobalContext>({ config, logs }, { cors: {} })
  await instrumentHttpServerWithMetrics({ metrics, server, config })

  const statusChecks = await createStatusCheckComponent({ server, config })

  const awsConfig: AwsConfig = {
    region: await config.requireString('AWS_REGION')
  }
  const accessKeyId = await config.getString('AWS_ACCESS_KEY_ID')
  const secretAccessKey = await config.getString('AWS_SECRET_ACCESS_KEY')
  if (accessKeyId && secretAccessKey) {
    awsConfig.credentials = {
      accessKeyId: (await config.getString('AWS_ACCESS_KEY_ID')) || '',
      secretAccessKey: (await config.getString('AWS_SECRET_ACCESS_KEY')) || ''
    }
  }
  const awsEndpoint = await config.getString('AWS_ENDPOINT')
  if (awsEndpoint) {
    awsConfig.endpoint = awsEndpoint
    awsConfig.forcePathStyle = true
  }

  const storage = await createStorageComponent({ awsConfig, config, metrics, logs })

  const fetch = await createFetchComponent()

  const godot = await createGodotSnapshotComponent({
    fetch,
    config,
    logs,
    metrics
  })

  const profileFetcher = await createProfileFetcher({
    config,
    fetch
  })

  const queue = await createQueueComponent({ awsConfig }, await config.requireString('QUEUE_NAME'))
  const retryQueue = await createQueueComponent({ awsConfig }, await config.requireString('RETRY_QUEUE_NAME'))

  const queueWorker = await createConsumerComponent({
    config,
    logs,
    godot,
    queue,
    retryQueue,
    storage
  })

  const retryQueueWorker = await createRetryConsumerComponent({
    config,
    logs,
    godot,
    queue,
    retryQueue,
    storage
  })

  const jobProducer = await createProducerComponent({
    config,
    logs,
    profileFetcher,
    queue,
    storage
  })

  return {
    awsConfig,
    config,
    fetch,
    godot,
    jobProducer,
    logs,
    metrics,
    profileFetcher,
    queue,
    retryQueue,
    queueWorker,
    retryQueueWorker,
    server,
    storage,
    statusChecks
  }
}
