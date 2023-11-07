ARG RUN
ARG COMMIT_HASH=local
ARG CURRENT_VERSION=Unknown

FROM node:lts-slim

ENV NODE_ENV production
ENV COMMIT_HASH=${COMMIT_HASH:-local}
ENV CURRENT_VERSION=${CURRENT_VERSION:-Unknown}
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD true

WORKDIR /app

RUN apt-get update && apt-get upgrade -y && apt-get install -y chromium

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
ENTRYPOINT  [ "/usr/local/bin/node", "--trace-warnings", "--abort-on-uncaught-exception", "--unhandled-rejections=strict", "dist/index.js" ]
