import { sqsStatus } from '../../logic/queue'
import { HandlerContextWithPath, StatusResponse } from '../../types'
import { IHttpServerComponent } from '@well-known-components/interfaces'

export async function statusHandler(
  context: HandlerContextWithPath<'config' | 'sqsClient', '/status'>
): Promise<IHttpServerComponent.IResponse> {
  const { config, sqsClient } = context.components

  const [mainQueueUrl, retryQueueUrl, commitHash, version] = await Promise.all([
    config.requireString('QUEUE_NAME'),
    config.requireString('RETRY_QUEUE_NAME'),
    config.getString('COMMIT_HASH'),
    config.getString('CURRENT_VERSION')
  ])

  const [queueStatus, retryQueueStatus] = await Promise.all([
    sqsStatus(sqsClient, mainQueueUrl),
    sqsStatus(sqsClient, retryQueueUrl)
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
