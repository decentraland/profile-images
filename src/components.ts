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
import { createProducerComponent } from './adapters/producer'
import { createGodotSnapshotComponent } from './adapters/godot'
import { createSQSClient } from './adapters/sqs'
import { createFetchComponent } from '@well-known-components/fetch-component'
import { createAwsConfig } from './adapters/aws-config'

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

  const consumer = await createConsumerComponent({
    config,
    logs,
    godot,
    sqsClient,
    storage,
    metrics
  })

  const producer = await createProducerComponent({
    config,
    logs,
    sqsClient,
    storage,
    fetch
  })

  return {
    awsConfig,
    config,
    fetch,
    godot,
    producer,
    logs,
    metrics,
    sqsClient,
    consumer,
    server,
    storage,
    statusChecks
  }
}
