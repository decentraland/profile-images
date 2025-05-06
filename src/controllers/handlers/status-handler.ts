import { HandlerContextWithPath, StatusResponse } from '../../types'
import { IHttpServerComponent } from '@well-known-components/interfaces'

export async function statusHandler(
  context: HandlerContextWithPath<'config' | 'mainQueue' | 'dlQueue', '/status'>
): Promise<IHttpServerComponent.IResponse> {
  const { config, mainQueue, dlQueue } = context.components

  const [commitHash, version] = await Promise.all([
    config.getString('COMMIT_HASH'),
    config.getString('CURRENT_VERSION')
  ])

  const [queueStatus, dlqStatus] = await Promise.all([mainQueue.getStatus(), dlQueue.getStatus()])

  const status: StatusResponse = {
    commitHash: commitHash || 'Unknown',
    version: version || 'Unknown',
    queues: {
      queue: queueStatus,
      dlQueue: dlqStatus
    }
  }

  return {
    status: 200,
    body: status
  }
}
