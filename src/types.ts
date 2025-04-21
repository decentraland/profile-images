import type {
  IBaseComponent,
  IConfigComponent,
  IFetchComponent,
  IHttpServerComponent,
  ILoggerComponent,
  IMetricsComponent
} from '@well-known-components/interfaces'
import { metricDeclarations } from './metrics'
import { GodotComponent } from './adapters/godot'
import { AvatarInfo } from '@dcl/schemas'
import { SqsClient } from './adapters/sqs'
import { Message, MessageSystemAttributeName } from '@aws-sdk/client-sqs'
import { IStorageComponent } from './adapters/storage'
import { AwsConfig } from './adapters/aws-config'
import { EntityFetcher } from './adapters/entity-fetcher'
import { ImageProcessor } from './logic/image-processor'
import { MessageValidator } from './logic/message-validator'
import { QueueComponent } from './logic/queue'

export type GlobalContext = {
  components: BaseComponents
}

// components used in every environment
export type BaseComponents = {
  awsConfig: AwsConfig
  config: IConfigComponent
  fetch: IFetchComponent
  godot: GodotComponent
  logs: ILoggerComponent
  metrics: IMetricsComponent<keyof typeof metricDeclarations>
  sqsClient: SqsClient
  entityFetcher: EntityFetcher
  consumer: QueueWorker
  server: IHttpServerComponent<GlobalContext>
  storage: IStorageComponent
  imageProcessor: ImageProcessor
  messageValidator: MessageValidator
  queue: QueueComponent
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

export type StatusResponse = {
  commitHash: string
  version: string
  queues: any
}

export type ExtendedAvatar = {
  entity: string
  avatar: AvatarInfo
}

export type ReceiveMessageOptions = {
  maxNumberOfMessages: number
  waitTimeSeconds?: number
  visibilityTimeout?: number
  messageSystemAttributeNames?: MessageSystemAttributeName[]
}

export type AvatarGenerationResult = ExtendedAvatar & {
  success: boolean
  avatarPath: string
  facePath: string
}

export type QueueWorker = IBaseComponent & {
  processMessages: (queueUrl: string, messages: Message[]) => Promise<void>
  poll: () => Promise<{ queueUrl: string; messages: Message[] }>
}
