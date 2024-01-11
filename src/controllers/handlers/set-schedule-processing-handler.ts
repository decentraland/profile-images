import { HandlerContextWithPath, InvalidRequestError, QueueMessage } from '../../types'
import { IHttpServerComponent } from '@well-known-components/interfaces'

export async function scheduleProcessingHandler(
  context: HandlerContextWithPath<'jobProducer' | 'logs' | 'queue' | 'profileFetcher', '/schedule-processing'>
): Promise<IHttpServerComponent.IResponse> {
  const {
    request,
    components: { logs, queue }
  } = context

  const logger = logs.getLogger('schedule-processing-handler')

  const body = await request.json()
  if (!body || typeof body !== 'object' || !Array.isArray(body)) {
    throw new InvalidRequestError('Invalid request. Request body is not valid')
  }

  for (const entity of body) {
    const message: QueueMessage = { entity, attempt: 0 }
    await queue.send(message)
    logger.debug(`Added to queue entity="${entity}"`)
  }

  return {
    status: 204
  }
}
