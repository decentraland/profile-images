import { SQSClient } from "@aws-sdk/client-sqs";
import { config, getAWSConfig } from "./modules/config";
import { getAddressesWithChanges } from "./modules/peer";
import { sleep } from "./modules/sleep";
import { Queue, QueueMessage } from "./modules/queue";

const aws = getAWSConfig();
const sqs = new SQSClient(aws);
const queue = new Queue(sqs, config.QUEUE_NAME);

async function poll(
  peerUrl: string,
  ms: number,
  lastTimestamp: number
): Promise<void> {
  try {
    console.log(`Polling changes...`);
    const { addresses, timestamp } = await getAddressesWithChanges(
      peerUrl,
      lastTimestamp
    );
    console.log(`Results: ${addresses.length}`);
    for (const address of addresses) {
      const message: QueueMessage = { address };
      await queue.send(message);
      console.log(`Added to queue: ${address}`);
    }
    await sleep(ms);
    return await poll(peerUrl, ms, timestamp);
  } catch (error) {
    console.error(error);
    await sleep(ms);
    return await poll(peerUrl, ms, lastTimestamp);
  }
}

async function main() {
  await poll(config.PEER_URL, config.INTERVAL, Date.now() - config.INTERVAL);
}

main().catch(console.error);
