import { HandlerContextWithPath, StatusResponse } from '../../types'
import { IHttpServerComponent } from '@well-known-components/interfaces'

export async function statusHandler(
  context: HandlerContextWithPath<'config' | 'queueService', '/status'>
): Promise<IHttpServerComponent.IResponse> {
  const { config, queueService } = context.components

  const [mainQueueUrl, retryQueueUrl, commitHash, version] = await Promise.all([
    config.requireString('QUEUE_NAME'),
    config.requireString('RETRY_QUEUE_NAME'),
    config.getString('COMMIT_HASH'),
    config.getString('CURRENT_VERSION')
  ])

  const [queueStatus, retryQueueStatus] = await Promise.all([
    queueService.status(mainQueueUrl),
    queueService.status(retryQueueUrl)
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
