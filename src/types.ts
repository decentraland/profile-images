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
import { GodotComponent } from './adapters/godot'
import { AvatarInfo } from '@dcl/schemas'

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
  queue: QueueService
  retryQueue: QueueService
  consumer: QueueWorker
  retryConsumer: QueueWorker
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
  queues: any
}

export type AwsConfig = {
  region: string
  credentials?: { accessKeyId: string; secretAccessKey: string }
  endpoint?: string
  forcePathStyle?: boolean
}

export type IStorageComponent = {
  store(key: string, content: Buffer, contentType: string): Promise<void>
  retrieve(key: string): Promise<Buffer | undefined>
  deleteMultiple(keys: string[]): Promise<void>
  storeImages(entity: string, avatarPath: string, facePath: string): Promise<boolean>
}

export type ExtendedAvatar = {
  entity: string
  avatar: AvatarInfo
}

export type AvatarGenerationResult = ExtendedAvatar & {
  success: boolean
  avatarPath: string
  facePath: string
}

export type QueueSendOptions = {
  delay?: number
}

export type QueueService = {
  send(message: ExtendedAvatar, options?: QueueSendOptions): Promise<void>
  receive(max: number): Promise<Message[]>
  deleteMessage(receiptHandle: string): Promise<void>
  status(): Promise<Record<string, any>>
}

export type QueueWorker = IBaseComponent & {
  setPaused(paused: boolean): void
}

export type JobProducer = IBaseComponent & {
  changeLastRun(ts: number): Promise<void>
}
