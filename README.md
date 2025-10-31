### Profile Images

[![Coverage Status](https://coveralls.io/repos/github/decentraland/profile-images/badge.svg?branch=coverage)](https://coveralls.io/github/decentraland/profile-images?branch=coverage)

This project generates profile images from users' 3D avatar models, producing both body and face images. These images are exposed via an API, allowing them to be seamlessly integrated into any desired application. 

The profile image services consists of two services:

- **Producer**: polls a target catalyst to fetch the latest profiles that have changes, and it adds them as jobs into SQS.

- **Consumer**: receives messages from the queue and for each job it generates the profile images of the requested profile, and puts them into an S3 bucket.

### Local Development

You will need a few dependencies to run Amazon's SQS and S3 services locally:

- You need to have [Docker](https://www.docker.com/get-started) installed in your machine, you can run `brew install --cask docker` in MacOS.
- Install [localstack CLI](https://docs.localstack.cloud/getting-started/installation/#localstack-cli), you can run `brew install localstack/tap/localstack-cli` in MacOS.
- Install `awslocal CLI`, you can run `pip3 install awscli --upgrade --user` in MacOS. You might need add the Python binaries to your PATH so you can run `awslocal` on the terminal: `export PATH=/Users/<your-user-name>/Library/Python/<version>/bin/:$PATH`. Replace `<your-user-name>` with your unix username and `<version>` with the python version (only major and minor, like `3.9`, you can check the version installed by running `python3 --version`).

Set the next variables for local env:
```
export AWS_ACCESS_KEY_ID="test"
export AWS_SECRET_ACCESS_KEY="test"
export AWS_DEFAULT_REGION="us-east-1"
```

Once you have everything above setup, do the following:

- Run `localstack start` on a separate terminal an leave it running
- Run `awslocal sqs create-queue --queue-name profile-images-queue` to create an SQS
- Run `awslocal sqs create-queue --queue-name profile-images-retry-queue` to create the retry SQS
- Run `awslocal s3api create-bucket --bucket profile-images-bucket` to create an S3

Now copy the env variables from the example:

- Run `cp .env.example .env`

Finally, start build and start the consumer service

- Run `yarn build`
- Run `yarn start`

And run the producer service to start adding jobs to the queue

- Run `yarn run start:producer`

## Comparing Images

Generating entities:

```bash
http https://peer.decentraland.org/content/deployments | jq '.deployments[] | select(.entityType == "profile") | .entityId' | cut -d\" -f2  | sort | uniq > entities
cat entities | bin/compare.sh
```

## 🤖 AI Agent Context

**Service Purpose:** Generates 2D profile images (body and face) from 3D avatar models. Uses a producer-consumer pattern to monitor profile changes and render avatar images for display in applications, social features, and user interfaces.

**Key Capabilities:**

- **Producer Service**: Polls Catalyst for profile deployments, detects avatar changes, queues rendering jobs to SQS
- **Consumer Service**: Processes rendering jobs, generates avatar images using 3D rendering pipeline, uploads images to S3
- Monitors profile entity changes via Catalyst `/content/pointer-changes` endpoint
- Generates body and face images from avatar 3D models
- Stores generated images in S3 bucket for CDN distribution
- Supports retry queue for failed rendering jobs

**Communication Pattern:** 
- Polling-based (Producer polls Catalyst periodically)
- Event-driven via AWS SQS (Consumer processes rendering jobs)

**Technology Stack:**

- Runtime: Node.js
- Language: TypeScript
- Queue: AWS SQS (rendering job queue, retry queue)
- Storage: AWS S3 (generated profile images)
- Rendering: 3D avatar rendering pipeline (likely Unity or similar)

**External Dependencies:**

- Content Servers: Catalyst nodes (profile entity fetching, pointer changes monitoring)
- Queue: AWS SQS (rendering jobs, retry queue)
- Storage: AWS S3 (generated image storage)

**Workflow:**

1. Producer polls Catalyst for profile changes
2. Detects new/updated profiles, queues rendering job to SQS
3. Consumer receives job, fetches avatar data
4. Consumer renders 3D avatar to 2D images (body, face)
5. Consumer uploads images to S3
6. Images served via CDN for applications
