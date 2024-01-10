ARG RUN
ARG COMMIT_HASH=local
ARG CURRENT_VERSION=Unknown

FROM quay.io/decentraland/godot-explorer:75dd06e4274470e8c6b7e5f4639985a7825e3d0e

RUN apt-get install -y ca-certificates

# Install node
RUN curl -fsSL https://deb.nodesource.com/setup_20.x  | bash - && apt-get -y install nodejs

# Clean apt cache
RUN rm -rf /var/lib/apt/lists/* /var/cache/apt/*

WORKDIR /app

ENV COMMIT_HASH=${COMMIT_HASH:-local}
ENV CURRENT_VERSION=${CURRENT_VERSION:-Unknown}

# build the app
COPY . /app

# Make commit hash available to application
RUN echo "COMMIT_HASH=$COMMIT_HASH" >> .env

RUN npm i --global yarn
RUN yarn --frozen-lockfile
RUN yarn build

ENV NODE_ENV production

# Please _DO NOT_ use a custom ENTRYPOINT because it may prevent signals
# (i.e. SIGTERM) to reach the service
# Read more here: https://aws.amazon.com/blogs/containers/graceful-shutdowns-with-ecs/
#            and: https://www.ctl.io/developers/blog/post/gracefully-stopping-docker-containers/
#ENTRYPOINT ["/usr/bin/tini", "--"]
# Run the program under Tini
ENTRYPOINT [ "/bin/bash", "/app/entrypoint.sh" ]
#ENTRYPOINT  [ "/usr/local/bin/node", "--trace-warnings", "--abort-on-uncaught-exception", "--unhandled-rejections=strict", "dist/index.js" ]
