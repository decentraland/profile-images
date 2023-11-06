bin/awslocal s3api create-bucket --bucket profile-images-bucket
bin/awslocal sqs create-queue --queue-name profile-images-queue
docker run -it --rm  --network=host --env-file=.env --cap-add=SYS_ADMIN profile-mariano:latest
