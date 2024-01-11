#!/bin/bash

BUCKET=https://profile-images-bucket-43d0c58.s3.amazonaws.com
CONTENT=https://peer.decentraland.org/content

rm -r compare
mkdir -p compare

while IFS= read -r entity; do
  wget -q $BUCKET/${entity}/face.png -O compare/${entity}_godot_face.png
  if [ $? -eq 8 ]; then
    echo "${entity} is not yet processed"
    rm compare/${entity}_godot_face.png
    continue
  fi
  wget -q $BUCKET/${entity}/body.png -O compare/${entity}_godot_body.png

  wget -q $CONTENT/contents/${entity} -O compare/${entity}-profile.json

  BODY_HASH=$(cat compare/${entity}-profile.json | jq '.content[] | select(.file == "body.png") | .hash' | cut -d\" -f2)
  FACE_HASH=$(cat compare/${entity}-profile.json | jq '.content[] | select(.file == "face.png") | .hash' | cut -d\" -f2)

  wget -q $CONTENT/contents/${BODY_HASH} -O compare/${entity}_content_body.png
  wget -q $CONTENT/contents/${FACE_HASH} -O compare/${entity}_content_face.png

  rm compare/${entity}-profile.json
done
