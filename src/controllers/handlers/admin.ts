import { HandlerContextWithPath } from '../../types'
import { IHttpServerComponent } from '@well-known-components/interfaces'

export async function adminHandler(
  context: HandlerContextWithPath<'jobProducer' | 'logs' | 'consumer', '/tools'>
): Promise<IHttpServerComponent.IResponse> {
  const {
    request,
    components: { jobProducer, logs }
  } = context

  // TODO: add auth

  const logger = logs.getLogger('admin')
  const body = await request.json()

  if (body.lastRun) {
    await jobProducer.changeLastRun(body.lastRun)
    logger.debug(`Setting last run to: ${body.lastRun}`)
  }

  return {
    status: 204
  }
}
