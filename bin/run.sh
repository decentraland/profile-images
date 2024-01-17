bin/awslocal s3api create-bucket --bucket profile-images-bucket
bin/awslocal sqs create-queue --queue-name profile-images-queue
bin/awslocal sqs create-queue --queue-name profile-images-retry-queue

docker run -it --rm --network=host --env-file=.env --name=profiles -v ./dist:/app/dist  profile-mariano:latest

docker build . -t profile-images
docker run -it --rm --network=host --env-file=.env --name=profiles profile-images:latest

docker build . -t profile-images && docker run -it --rm --network=host --env-file=.env --name=profiles profile-images:latest
