import { HandlerContextWithPath } from '../../types'
import { IHttpServerComponent } from '@well-known-components/interfaces'

export async function adminHandler(
  context: HandlerContextWithPath<'jobProducer' | 'logs' | 'consumer' | 'retryConsumer', '/admin'>
): Promise<IHttpServerComponent.IResponse> {
  const {
    request,
    components: { jobProducer, logs, consumer, retryConsumer }
  } = context

  // TODO: add auth

  const logger = logs.getLogger('admin')
  const body = await request.json()

  if (body.lastRun) {
    await jobProducer.changeLastRun(body.lastRun)
    logger.debug(`Setting last run to: ${body.lastRun}`)
  }

  if (body.consumer) {
    await consumer.setPaused(body.consumer)
    logger.debug(`Consumer is now: ${body.consumer ? 'paused' : 'running'}`)
  }

  if (body.retryConsumer) {
    await retryConsumer.setPaused(body.retryConsumer)
    logger.debug(`RetryConsumer is now: ${body.retryConsumer ? 'paused' : 'running'}`)
  }

  return {
    status: 204
  }
}
