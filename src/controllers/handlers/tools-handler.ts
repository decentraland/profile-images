import { HandlerContextWithPath } from '../../types'
import { IHttpServerComponent } from '@well-known-components/interfaces'

export async function toolsHandler(
  context: HandlerContextWithPath<'producer' | 'logs', '/tools'>
): Promise<IHttpServerComponent.IResponse> {
  const {
    request,
    components: { producer, logs }
  } = context

  const logger = logs.getLogger('admin')
  const body = await request.json()
  if (body.lastRun) {
    await producer.changeLastRun(body.lastRun)
    logger.debug(`Setting last run to: ${body.lastRun}`)
  }

  return {
    status: 204
  }
}
