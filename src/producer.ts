import { SQSClient } from '@aws-sdk/client-sqs'
import { config, getAWSConfig } from './modules/config'
import { getProfilesWithChanges } from './modules/peer'
import { sleep } from './modules/sleep'
import { Queue } from './modules/queue'
import { QueueMessage } from './types'

const aws = getAWSConfig()
const sqs = new SQSClient(aws)
const queue = new Queue(sqs, config.QUEUE_NAME)

async function poll(peerUrl: string, ms: number, lastTimestamp: number): Promise<void> {
  try {
    console.log(`Polling changes...`)
    const { profiles, timestamp } = await getProfilesWithChanges(peerUrl, lastTimestamp)
    console.log(`Results: ${profiles.length}`)
    for (const [address, entity] of profiles) {
      const message: QueueMessage = { address, entity }
      await queue.send(message)
      console.log(`Added to queue address="${address}" and entity="${entity}"`)
    }
    await sleep(ms)
    return await poll(peerUrl, ms, timestamp)
  } catch (error) {
    console.error(error)
    await sleep(ms)
    return await poll(peerUrl, ms, lastTimestamp)
  }
}

async function main() {
  await poll(config.PEER_URL, config.INTERVAL, Date.now() - config.INTERVAL)
}

main().catch(console.error)
