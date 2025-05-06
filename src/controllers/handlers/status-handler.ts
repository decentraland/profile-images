import { HandlerContextWithPath, StatusResponse } from '../../types'
import { IHttpServerComponent } from '@well-known-components/interfaces'

export async function statusHandler(
  context: HandlerContextWithPath<'config' | 'queue', '/status'>
): Promise<IHttpServerComponent.IResponse> {
  const { config, queue } = context.components

  const [mainQueueUrl, dlqUrl, commitHash, version] = await Promise.all([
    config.requireString('QUEUE_URL'),
    config.requireString('DLQ_URL'),
    config.getString('COMMIT_HASH'),
    config.getString('CURRENT_VERSION')
  ])

  const [queueStatus, dlqStatus] = await Promise.all([queue.getStatus(mainQueueUrl), queue.getStatus(dlqUrl)])

  const status: StatusResponse = {
    commitHash: commitHash || 'Unknown',
    version: version || 'Unknown',
    queues: {
      queue: queueStatus,
      retryQueue: dlqStatus
    }
  }

  return {
    status: 200,
    body: status
  }
}
