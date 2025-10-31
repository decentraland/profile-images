#!/bin/bash

# This script is executed when LocalStack is ready.
# It creates the SQS queues and S3 bucket required by the application.

echo "Attempting to create AWS resources for profile-images service..."

# Default AWS credentials and region for LocalStack's awslocal
export AWS_ACCESS_KEY_ID="test"
export AWS_SECRET_ACCESS_KEY="test"
export AWS_DEFAULT_REGION="us-east-1"
# The endpoint is implicitly localhost:4566 when using awslocal within the LocalStack container

QUEUE_NAME="profile-images-queue"
DLQ_NAME="profile-images-dlq"
BUCKET_NAME="profile-images-bucket"

# Create main queue
awslocal sqs create-queue --queue-name ${QUEUE_NAME}
if [ $? -eq 0 ]; then
    echo "Successfully created SQS queue: ${QUEUE_NAME}"
else
    echo "Failed to create SQS queue: ${QUEUE_NAME}" >&2
fi

# Create Dead Letter Queue
awslocal sqs create-queue --queue-name ${DLQ_NAME}
if [ $? -eq 0 ]; then
    echo "Successfully created SQS queue: ${DLQ_NAME}"
else
    echo "Failed to create SQS queue: ${DLQ_NAME}" >&2
fi

# Create S3 bucket for storing profile images
awslocal s3 mb s3://${BUCKET_NAME}
if [ $? -eq 0 ]; then
    echo "Successfully created S3 bucket: ${BUCKET_NAME}"
else
    echo "Failed to create S3 bucket: ${BUCKET_NAME}" >&2
fi

echo "AWS resource creation process finished." 