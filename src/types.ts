import type { IFetchComponent } from '@well-known-components/http-server'
import type {
  IBaseComponent,
  IConfigComponent,
  IHttpServerComponent,
  ILoggerComponent,
  IMetricsComponent
} from '@well-known-components/interfaces'
import { metricDeclarations } from './metrics'
import { Message } from '@aws-sdk/client-sqs'

export type GlobalContext = {
  components: BaseComponents
}

// components used in every environment
export type BaseComponents = {
  awsConfig: AwsConfig
  config: IConfigComponent
  fetch: IFetchComponent
  godot: GodotComponent
  jobProducer: JobProducer
  logs: ILoggerComponent
  metrics: IMetricsComponent<keyof typeof metricDeclarations>
  profileFetcher: ProfileFetcher
  queue: QueueService
  retryQueue: QueueService
  queueWorker: QueueWorker
  server: IHttpServerComponent<GlobalContext>
  storage: IStorageComponent
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
  version: string
}

export type AwsConfig = {
  region: string
  credentials?: { accessKeyId: string; secretAccessKey: string }
  endpoint?: string
  forcePathStyle?: boolean
}

export type IStorageComponent = {
  store(key: string, content: Buffer): Promise<void>
  retrieve(key: string): Promise<Buffer | undefined>
  deleteMultiple(keys: string[]): Promise<void>
  storeImages(entity: string, avatarPath: string, facePath: string): Promise<boolean>
}

export type Images = {
  body: Buffer
  face: Buffer
}

export type AvatarGenerationResult = {
  entity: string
  status: boolean
  error?: string
  avatarPath: string
  facePath: string
}

export type GodotComponent = {
  generateImages(entities: string[]): Promise<AvatarGenerationResult[]>
}

export type QueueSendOptions = {
  delay?: number
}

export type QueueService = {
  send(message: QueueMessage, options?: QueueSendOptions): Promise<void>
  receive(max: number): Promise<Message[]>
  deleteMessage(receiptHandle: string): Promise<void>
}

export type QueueMessage = {
  entity: string
  attempt: number
}

export type QueueWorker = IBaseComponent
export type JobProducer = IBaseComponent & {
  changeLastRun(ts: number): Promise<void>
}

export type ProfileFetcher = {
  getProfilesWithChanges(from: number): Promise<{ entities: string[]; timestamp: number }>
}
