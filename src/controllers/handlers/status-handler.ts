import { HandlerContextWithPath, StatusResponse } from '../../types'
import { IHttpServerComponent } from '@well-known-components/interfaces'

export async function statusHandler(
  context: HandlerContextWithPath<'config' | 'queue' | 'retryQueue', '/status'>
): Promise<IHttpServerComponent.IResponse> {
  const { config } = context.components

  const [commitHash, version] = await Promise.all([
    config.getString('COMMIT_HASH'),
    config.getString('CURRENT_VERSION')
  ])

  const [queueStatus, retryQueueStatus] = await Promise.all([
    context.components.queue.status(),
    context.components.retryQueue.status()
  ])

  const status: StatusResponse = {
    commitHash: commitHash || 'Unknown',
    version: version || 'Unknown',
    queues: {
      queue: queueStatus,
      retryQueue: retryQueueStatus
    }
  }

  return {
    status: 200,
    body: status
  }
}
