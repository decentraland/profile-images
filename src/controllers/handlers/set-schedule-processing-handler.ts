import { HandlerContextWithPath, InvalidRequestError, QueueMessage } from '../../types'
import { IHttpServerComponent } from '@well-known-components/interfaces'
import { SQSClient } from '@aws-sdk/client-sqs'
import { Queue } from '../../logic/queue'

export async function scheduleProcessingHandler(
  _context: HandlerContextWithPath<
    'awsConfig' | 'config' | 'jobProducer' | 'logs' | 'profileFetcher',
    '/schedule-processing'
  >
): Promise<IHttpServerComponent.IResponse> {
  const { awsConfig, config, logs } = _context.components
  const logger = logs.getLogger('schedule-processing-handler')

  const body = await _context.request.json()
  console.log('body', body)
  if (!body || typeof body !== 'object' || !Array.isArray(body)) {
    throw new InvalidRequestError('Invalid request. Request body is not valid')
  }

  const sqs = new SQSClient(awsConfig)
  const queueName = await config.requireString('QUEUE_NAME')
  const queue = new Queue(sqs, queueName)

  logger.debug(`Got ${body.length} profiles with changes`)
  for (const entity of body) {
    const message: QueueMessage = { entity }
    await queue.send(message)
    logger.debug(`Added to queue entity="${entity}"`)
  }

  return {
    status: 204
  }
}
