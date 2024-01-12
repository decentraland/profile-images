bin/awslocal s3api create-bucket --bucket profile-images-bucket
bin/awslocal sqs create-queue --queue-name profile-images-queue
bin/awslocal sqs create-queue --queue-name profile-images-retry-queue
