import { HandlerContextWithPath, StatusResponse } from '../../types'
import { IHttpServerComponent } from '@well-known-components/interfaces'

export async function statusHandler(
  context: HandlerContextWithPath<'config' | 'queue', '/status'>
): Promise<IHttpServerComponent.IResponse> {
  const { config, queue } = context.components

  const [mainQueueUrl, retryQueueUrl, commitHash, version] = await Promise.all([
    config.requireString('QUEUE_NAME'),
    config.requireString('RETRY_QUEUE_NAME'),
    config.getString('COMMIT_HASH'),
    config.getString('CURRENT_VERSION')
  ])

  const [queueStatus, retryQueueStatus] = await Promise.all([
    queue.getStatus(mainQueueUrl),
    queue.getStatus(retryQueueUrl)
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
