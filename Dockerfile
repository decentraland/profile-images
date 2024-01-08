ARG RUN
ARG COMMIT_HASH=local
ARG CURRENT_VERSION=Unknown

FROM node:lts-slim

# Install dependencies
RUN apt-get update -y \
    && apt-get -y install \
        xvfb libasound2-dev libudev-dev \
        clang curl pkg-config libavcodec-dev libavformat-dev libavutil-dev libavfilter-dev libavdevice-dev \
        libssl-dev libx11-dev libgl1-mesa-dev libxext-dev gnupg wget unzip

# Download Dcl Godot Explorer
ARG DCL_GODOT_VERSION="v0.7.0-alpha"
ENV EXPLORER_PATH=/explorer
RUN mkdir -p ${EXPLORER_PATH} \
    && cd ${EXPLORER_PATH} \
    && wget -O explorer.zip https://github.com/decentraland/godot-explorer/releases/download/${DCL_GODOT_VERSION}/decentraland-godot-ubuntu-latest.zip \
    && unzip explorer.zip \
    && chmod +x decentraland.godot.client.x86_64 \
    && rm explorer.zip

WORKDIR /app

ENV EXPLORER_PATH=/explorer
ENV NODE_ENV production
ENV COMMIT_HASH=${COMMIT_HASH:-local}
ENV CURRENT_VERSION=${CURRENT_VERSION:-Unknown}

# build the app
COPY . /app

# Make commit hash available to application
RUN echo "COMMIT_HASH=$COMMIT_HASH" >> .env

RUN yarn install --prod --frozen-lockfile
RUN yarn build


# Please _DO NOT_ use a custom ENTRYPOINT because it may prevent signals
# (i.e. SIGTERM) to reach the service
# Read more here: https://aws.amazon.com/blogs/containers/graceful-shutdowns-with-ecs/
#            and: https://www.ctl.io/developers/blog/post/gracefully-stopping-docker-containers/
#ENTRYPOINT ["/usr/bin/tini", "--"]
# Run the program under Tini
#CMD  [ "/usr/bin/node", "--trace-warnings", "--abort-on-uncaught-exception", "--unhandled-rejections=strict", "dist/index.js" ]
ENTRYPOINT  [ "/usr/local/bin/node", "--trace-warnings", "--abort-on-uncaught-exception", "--unhandled-rejections=strict", "dist/index.js" ]
