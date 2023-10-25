import fs from "fs";
import path from "path";
import { SQSClient } from "@aws-sdk/client-sqs";
import { S3Client } from "@aws-sdk/client-s3";
import { config, getAWSConfig } from "./modules/config";
import { Queue } from "./modules/queue";
import { sleep } from "./modules/sleep";
import { Bucket } from "./modules/bucket";
import { Snapshot } from "./modules/snapshot";

const aws = getAWSConfig();
const sqs = new SQSClient(aws);
const s3 = new S3Client(aws);
const queue = new Queue(sqs, config.QUEUE_NAME);
const cache = Math.round(config.INTERVAL / 1000);
const bucket = new Bucket(s3, config.BUCKET_NAME, cache);
const snapshot = new Snapshot();

async function job() {
  const didWork = await queue.receive(async (message) => {
    console.log(`Processing: ${message.entity}`);
    console.time(`Snapshots ${message.entity}`);
    const [face, body] = await Promise.all([
      snapshot.getFace(message.address),
      snapshot.getBody(message.address),
    ]);
    console.timeEnd(`Snapshots ${message.entity}`);
    console.time(`Upload ${message.entity}`);
    await bucket.saveSnapshots(message.entity, face, body);
    console.timeEnd(`Upload ${message.entity}`);
  }, config.MAX_JOBS);
  if (!didWork) {
    console.log(`Queue empty`);
    await sleep(config.INTERVAL / 2);
  }
}

async function main() {
  while (true) {
    await job();
  }
}

main().catch(console.error);
