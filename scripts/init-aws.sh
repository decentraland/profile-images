#!/bin/bash

# This script creates the SQS queues and S3 bucket required by the application.
# It runs both inside the LocalStack container (via ready.d mount) and on the host (via setup:localstack).

echo "Attempting to create AWS resources for profile-images service..."

export AWS_ACCESS_KEY_ID="test"
export AWS_SECRET_ACCESS_KEY="test"
export AWS_DEFAULT_REGION="us-east-1"

QUEUE_NAME="profile-images-queue"
DLQ_NAME="profile-images-dlq"
BUCKET_NAME="profile-images-bucket"

# Use awslocal if available (inside LocalStack container), otherwise fall back to aws CLI
if command -v awslocal &> /dev/null; then
    AWS_CMD="awslocal"
else
    ENDPOINT="${AWS_ENDPOINT_URL:-http://127.0.0.1:4566}"
    AWS_CMD="aws --endpoint-url ${ENDPOINT}"
fi

# Create main queue
${AWS_CMD} sqs create-queue --queue-name ${QUEUE_NAME}
if [ $? -eq 0 ]; then
    echo "Successfully created SQS queue: ${QUEUE_NAME}"
else
    echo "Failed to create SQS queue: ${QUEUE_NAME}" >&2
fi

# Create Dead Letter Queue
${AWS_CMD} sqs create-queue --queue-name ${DLQ_NAME}
if [ $? -eq 0 ]; then
    echo "Successfully created SQS queue: ${DLQ_NAME}"
else
    echo "Failed to create SQS queue: ${DLQ_NAME}" >&2
fi

# Create S3 bucket for storing profile images
${AWS_CMD} s3 mb s3://${BUCKET_NAME}
if [ $? -eq 0 ]; then
    echo "Successfully created S3 bucket: ${BUCKET_NAME}"
else
    echo "Failed to create S3 bucket: ${BUCKET_NAME}" >&2
fi

echo "AWS resource creation process finished."
