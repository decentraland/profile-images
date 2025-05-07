import { Message } from '@aws-sdk/client-sqs'
import { AppComponents, ExtendedAvatar, QueueWorker } from '../types'
import { sleep } from '../logic/sleep'
import { sqsDeleteMessage, sqsReceiveMessage, sqsSendMessage } from '../logic/queue'
import { START_COMPONENT, STOP_COMPONENT } from '@well-known-components/interfaces'

export async function createConsumerComponent({
  config,
  logs,
  godot,
  sqsClient,
  storage,
  metrics
}: Pick<AppComponents, 'config' | 'logs' | 'godot' | 'storage' | 'sqsClient' | 'metrics'>): Promise<QueueWorker> {
  const logger = logs.getLogger('consumer')
  const [mainQueueUrl, retryQueueUrl, commitHash, version] = await Promise.all([
    config.requireString('QUEUE_NAME'),
    config.requireString('RETRY_QUEUE_NAME'),
    config.getString('COMMIT_HASH'),
    config.getString('CURRENT_VERSION')
  ])

  let processLoopPromise: Promise<void> | null = null

  async function poll() {
    let queueUrl = mainQueueUrl
    let messages = await sqsReceiveMessage(sqsClient, queueUrl, { maxNumberOfMessages: 10 })
    if (messages.length === 0) {
      queueUrl = retryQueueUrl
      messages = await sqsReceiveMessage(sqsClient, queueUrl, { maxNumberOfMessages: 1 })
    }

    return { queueUrl, messages }
  }

  async function process(queueUrl: string, messages: Message[]) {
    logger.debug(`Processing: ${messages.length} profiles`)

    const messageByEntity = new Map<string, Message>()

    const input: ExtendedAvatar[] = []
    for (const message of messages) {
      if (!message.Body) {
        logger.warn(
          `Message with MessageId=${message.MessageId} and ReceiptHandle=${message.ReceiptHandle} arrived with undefined Body`
        )
        await sqsDeleteMessage(sqsClient, queueUrl, message.ReceiptHandle!)
        return
      }
      const body: ExtendedAvatar = JSON.parse(message.Body)
      if (!body.avatar) {
        logger.warn(
          `Message with MessageId=${message.MessageId} and ReceiptHandle=${message.ReceiptHandle} arrived with invalid Body: ${message.Body}`
        )
        await sqsDeleteMessage(sqsClient, queueUrl, message.ReceiptHandle!)
        return
      }

      if (messageByEntity.has(body.entity)) {
        // NOTE: we are already processing this entity in the batch
        await sqsDeleteMessage(sqsClient, queueUrl, message.ReceiptHandle!)
        continue
      }

      messageByEntity.set(body.entity, message)

      input.push(body)
    }

    logger.debug(`Processing: ${input[0].entity} entity`)
    const { avatars: results, output: outputGenerated } = await godot.generateImages(input)

    for (const result of results) {
      const message = messageByEntity.get(result.entity)!
      if (result.success) {
        metrics.increment('snapshot_generation_count', { status: 'success' }, 1)
        const success = await storage.storeImages(result.entity, result.avatarPath, result.facePath)
        if (!success) {
          logger.error(`Error saving generated images to s3 for entity=${result.entity}`)
          continue
        }
      } else if (messages.length === 1) {
        metrics.increment('snapshot_generation_count', { status: 'failure' }, 1)
        logger.debug(`Giving up on entity=${result.entity} because of godot failure.`)
        const failure = {
          timestamp: new Date().toISOString(),
          commitHash,
          version,
          entity: result.entity,
          outputGenerated
        }
        await storage.storeFailure(result.entity, JSON.stringify(failure))
      } else {
        logger.debug(`Godot failure, enqueue for individual retry, entity=${result.entity}`)
        await sqsSendMessage(sqsClient, retryQueueUrl, { entity: result.entity, avatar: result.avatar })
      }

      await sqsDeleteMessage(sqsClient, queueUrl, message.ReceiptHandle!)
    }
  }

  async function processLoop() {
    while (true) {
      try {
        const { queueUrl, messages } = await poll()

        if (messages.length === 0) {
          await sleep(20 * 1000)
          continue
        }

        await process(queueUrl, messages)
      } catch (error: any) {
        logger.error(error)
      }
    }
  }

  async function start() {
    logger.debug('Starting consumer')

    // Start the processing loop in the background
    processLoopPromise = processLoop()

    // Return immediately to not block other components
    return Promise.resolve()
  }

  async function stop() {
    logger.info('Stopping messages consumer component')

    if (processLoopPromise) {
      await processLoopPromise
      processLoopPromise = null
    }
  }

  return { [START_COMPONENT]: start, [STOP_COMPONENT]: stop, process, poll }
}
