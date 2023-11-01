ARG RUN

FROM node:slim as builderenv

WORKDIR /app

# some packages require a build step
RUN apt-get update && apt-get upgrade -y

# some packages require a build step
COPY package.json /app/package.json
COPY yarn.lock /app/yarn.lock
RUN yarn install --frozen-lockfile

# build the app
COPY . /app

# Make commit hash available to application
ARG COMMIT_HASH
RUN echo "COMMIT_HASH=$COMMIT_HASH" >> .env

RUN yarn build
RUN yarn test

# remove devDependencies, keep only used dependencies
RUN yarn install --prod --frozen-lockfile

########################## END OF BUILD STAGE ##########################

FROM node:slim

ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD true

RUN apt-get update && apt-get install tini gnupg wget -y && \
  wget --quiet --output-document=- https://dl-ssl.google.com/linux/linux_signing_key.pub | gpg --dearmor > /etc/apt/trusted.gpg.d/google-archive.gpg && \
  sh -c 'echo "deb [arch=amd64] http://dl.google.com/linux/chrome/deb/ stable main" >> /etc/apt/sources.list.d/google.list' && \
  apt-get update && \
  apt-get install google-chrome-stable -y --no-install-recommends && \
  rm -rf /var/lib/apt/lists/*

# NODE_ENV is used to configure some runtime options, like JSON logger
ENV NODE_ENV production
ENV CHROME_EXECUTABLE=/usr/bin/google-chrome

ARG COMMIT_HASH=local
ENV COMMIT_HASH=${COMMIT_HASH:-local}

ARG CURRENT_VERSION=Unknown
ENV CURRENT_VERSION=${CURRENT_VERSION:-Unknown}

WORKDIR /app
COPY --from=builderenv /app /app
#RUN node node_modules/puppeteer/install.mjs

# Please _DO NOT_ use a custom ENTRYPOINT because it may prevent signals
# (i.e. SIGTERM) to reach the service
# Read more here: https://aws.amazon.com/blogs/containers/graceful-shutdowns-with-ecs/
#            and: https://www.ctl.io/developers/blog/post/gracefully-stopping-docker-containers/
ENTRYPOINT ["/usr/bin/tini", "--"]
# Run the program under Tini
CMD [ "/usr/local/bin/node", "--trace-warnings", "--abort-on-uncaught-exception", "--unhandled-rejections=strict", "dist/index.js" ]
