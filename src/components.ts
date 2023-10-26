import { createDotEnvConfigComponent } from '@well-known-components/env-config-provider'
import { createServerComponent, createStatusCheckComponent } from '@well-known-components/http-server'
import { createLogComponent } from '@well-known-components/logger'
import { createMetricsComponent, instrumentHttpServerWithMetrics } from '@well-known-components/metrics'
import { AppComponents, AwsConfig, GlobalContext } from './types'
import { metricDeclarations } from './metrics'
import { createFetchComponent } from './adapters/fetch'
import { createConsumerComponent } from './consumer'
import { createStorageComponent } from './adapters/storage'
import { createBrowser } from './adapters/browser'
import { createSnapshotComponent } from './adapters/snapshot'

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
    region: await config.requireString('AWS_REGION'),
    credentials: {
      accessKeyId: await config.requireString('AWS_ACCESS_KEY_ID'),
      secretAccessKey: await config.requireString('AWS_SECRET_ACCESS_KEY')
    }
  }
  const awsEndpoint = await config.getString('AWS_ENDPOINT')
  if (awsEndpoint) {
    awsConfig.endpoint = awsEndpoint
    awsConfig.forcePathStyle = true
  }

  const storage = await createStorageComponent({ awsConfig, config })

  const fetch = await createFetchComponent()

  const browser = createBrowser()

  const snapshot = createSnapshotComponent({ browser, config })

  const queueWorker = await createConsumerComponent({
    awsConfig,
    config,
    snapshot,
    storage
  })

  return {
    awsConfig,
    browser,
    config,
    fetch,
    logs,
    metrics,
    queueWorker,
    server,
    snapshot,
    storage,
    statusChecks
  }
}
