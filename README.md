### Profile Images

The profile image services consists of two services:

- **Producer**: polls a target catalyst to fetch the latest profiles that have changes, and it adds them as jobs into SQS.

- **Consumer**: receives messages from the queue and for each job it generates the profile images of the requested profile, and puts them into an S3 bucket.

### Local Development

You will need a few dependencies to run Amazon's SQS and S3 services locally:

- You need to have [Docker](https://www.docker.com/get-started) installed in your machine, you can run `brew install --cask docker` in MacOS.
- Install [localstack CLI](https://docs.localstack.cloud/getting-started/installation/#localstack-cli), you can run `brew install localstack/tap/localstack-cli` in MacOS.
- Install `awslocal CLI`, you can run `pip3 install awscli --upgrade --user` in MacOS. You might need add the Python binaries to your PATH so you can run `awslocal` on the terminal: `export PATH=/Users/<your-user-name>/Library/Python/<version>/bin/:$PATH`. Replace `<your-user-name>` with your unix username and `<version>` with the python version (only major and minor, like `3.9`, you can check the version installed by running `python3 --version`).

Once you have everything above setup, do the following:

- Run `localstack start` on a separate terminal an leave it running
- Run `awslocal sqs create-queue --queue-name profile-images-queue` to create an SQS
- Run `awslocal s3api create-bucket --bucket profile-images-bucket` to create an S3

Now copy the env variables from the example:

- Run `cp .env.example .env`

Finally, start build and start the consumer service

- Run `yarn start`
- Run `yarn build`

And run the producer service to start adding jobs to the queue

- Run `yarn run start:producer`

## Comparing Images

Generating entities:

```bash
http https://peer.decentraland.org/content/deployments | jq '.deployments[] | select(.entityType == "profile") | .entityId' | cut -d\" -f2  | sort | uniq > entities
cat entities | bin/compare.sh
```
