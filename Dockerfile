ARG RUN
ARG COMMIT_HASH=local
ARG CURRENT_VERSION=Unknown

FROM ubuntu:23.10

ENV NODE_ENV production
ENV COMMIT_HASH=${COMMIT_HASH:-local}
ENV CURRENT_VERSION=${CURRENT_VERSION:-Unknown}
#ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD true

WORKDIR /app

# some packages require a build step
RUN apt-get update && apt-get upgrade -y

RUN apt-get update && \
  DEBIAN_FRONTEND=noninteractive \
  apt-get install -y \
  xorg xserver-xorg \
  xvfb \
  libx11-dev libxext-dev libnss3 libatk1.0-0 libatk-bridge2.0-0 libcups2 libxkbcommon0 libpango-1.0-0 libcairo2 libasound2 \
  nodejs npm

RUN npm install -g yarn

COPY package.json /app/package.json
COPY yarn.lock /app/yarn.lock
RUN yarn install --frozen-lockfile


# build the app
COPY . /app

# Make commit hash available to application
RUN echo "COMMIT_HASH=$COMMIT_HASH" >> .env

RUN yarn build


# Please _DO NOT_ use a custom ENTRYPOINT because it may prevent signals
# (i.e. SIGTERM) to reach the service
# Read more here: https://aws.amazon.com/blogs/containers/graceful-shutdowns-with-ecs/
#            and: https://www.ctl.io/developers/blog/post/gracefully-stopping-docker-containers/
#ENTRYPOINT ["/usr/bin/tini", "--"]
# Run the program under Tini
#CMD  [ "/usr/bin/node", "--trace-warnings", "--abort-on-uncaught-exception", "--unhandled-rejections=strict", "dist/index.js" ]
ENTRYPOINT  [ "/usr/bin/node", "--trace-warnings", "--abort-on-uncaught-exception", "--unhandled-rejections=strict", "dist/index.js" ]
