import dotenv from "dotenv";
dotenv.config();

export const config = {
  PEER_URL: process.env.PEER_URL || "https://peer.decentraland.org",
  INTERVAL: process.env.INTERVAL ? Number(process.env.INTERVAL) : 60_000,
  AWS_REGION: process.env.AWS_REGION || "us-east-1",
  AWS_ENDPOINT: process.env.AWS_ENDPOINT,
  AWS_ACCESS_KEY_ID: process.env.AWS_ACCESS_KEY_ID || "",
  AWS_SECRET_ACCESS_KEY: process.env.AWS_SECRET_ACCESS_KEY || "",
  QUEUE_NAME: process.env.QUEUE_NAME || "",
  BUCKET_NAME: process.env.BUCKET_NAME || "",
  MAX_JOBS: process.env.MAX_JOBS ? Number(process.env.MAX_JOBS) : 1,
};

export function getAWSConfig() {
  let aws: {
    region: string;
    credentials: { accessKeyId: string; secretAccessKey: string };
    endpoint?: string;
    forcePathStyle?: boolean;
  } = {
    region: config.AWS_REGION,
    credentials: {
      accessKeyId: config.AWS_ACCESS_KEY_ID,
      secretAccessKey: config.AWS_SECRET_ACCESS_KEY,
    },
  };
  if (config.AWS_ENDPOINT) {
    aws.endpoint = config.AWS_ENDPOINT;
    aws.forcePathStyle = true;
  }
  return aws;
}
