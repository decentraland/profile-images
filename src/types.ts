import type { IFetchComponent } from '@well-known-components/http-server'
import type {
  IBaseComponent,
  IConfigComponent,
  IHttpServerComponent,
  ILoggerComponent,
  IMetricsComponent
} from '@well-known-components/interfaces'
import { metricDeclarations } from './metrics'
import { ViewPort } from './adapters/browser'

export type GlobalContext = {
  components: BaseComponents
}

// components used in every environment
export type BaseComponents = {
  awsConfig: AwsConfig
  browser: Browser
  config: IConfigComponent
  fetch: IFetchComponent
  logs: ILoggerComponent
  metrics: IMetricsComponent<keyof typeof metricDeclarations>
  queueWorker: QueueWorker
  snapshot: Snapshot
  storage: IStorageComponent
  server: IHttpServerComponent<GlobalContext>
}

// components used in runtime
export type AppComponents = BaseComponents & {
  statusChecks: IBaseComponent
}

// components used in tests
export type TestComponents = BaseComponents & {
  // A fetch component that only hits the test server
  localFetch: IFetchComponent
}

// this type simplifies the typings of http handlers
export type HandlerContextWithPath<
  ComponentNames extends keyof AppComponents,
  Path extends string = any
> = IHttpServerComponent.PathAwareContext<
  IHttpServerComponent.DefaultContext<{
    components: Pick<AppComponents, ComponentNames>
  }>,
  Path
>

export type Context<Path extends string = any> = IHttpServerComponent.PathAwareContext<GlobalContext, Path>

export class InvalidRequestError extends Error {
  constructor(message: string) {
    super(message)
    Error.captureStackTrace(this, this.constructor)
  }
}

export class NotFoundError extends Error {
  constructor(message: string) {
    super(message)
    Error.captureStackTrace(this, this.constructor)
  }
}

export type StatusResponse = {
  commitHash: string
}

export type AwsConfig = {
  region: string
  credentials?: { accessKeyId: string; secretAccessKey: string }
  endpoint?: string
  forcePathStyle?: boolean
}

export type IStorageComponent = {
  store(key: string, content: Buffer): Promise<void>
}

export type Browser = {
  takeScreenshot(url: string, selector: string, viewport: ViewPort): Promise<Buffer>
}

export type Snapshot = {
  getBody(address: string): Promise<Buffer>
  getFace(address: string): Promise<Buffer>
}

export type QueueMessage = {
  address: string
  entity: string
}

export type QueueWorker = IBaseComponent
