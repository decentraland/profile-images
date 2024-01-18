FROM quay.io/decentraland/godot-explorer:f99a1ed32ab1cc7d7bb30c0f5ccf36b4840b4901

RUN apt-get install -y ca-certificates openssh-server

# Install node
RUN curl -fsSL https://deb.nodesource.com/setup_20.x  | bash - && apt-get -y install nodejs

# Clean apt cache
RUN rm -rf /var/lib/apt/lists/* /var/cache/apt/*

RUN mkdir -p /var/run/sshd /root/.ssh
RUN echo $'\nssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAACAQDSRWxPoHFjl4tqRFaUAylZ0n7JWsCCRG9qInfp1aZCJLVl82xpazMwgu9iJ7/RFadt5Mu2fMGzHrPLirfzUhq/IAAoYewgWcou7LSwvk5beBgKeFl5xYQQNDFEwtGlNmW78V+kNUHml06r0x44yT0NH+C8jOEVmuzA000u6h+W9nQ1APsCtHJUPpmGVrKifB4ew9vQWe9UWjrf2mKSztY07h1fAoZCjsXZC4lTnqP8STPgnd4VeENhSWtzGjwKPxJyuPVTiwIHJJZXCZDYTj7a+zwclyDWiRFS65xp8Zhhiz7jB1GmHCmRpc6yXybETkBo1Z9Hcq30wdZIoFsd/8MQvgyrec0gTioh+BdXXmzZKw8rVTUKK72TszHtz2eH1kFATwOc/1mofmBk67Xsm6/+9a9P7SLgALx+0mk4wklXmXPv0p2AABVLm203QIi49WiN/mriHL2pJD7abE6HruPHRLGKx1g+I3DqMBTJMd863I+lqVS3IXqjTrfDhEKJ+PgNLAF7jKHcCMRVs6ge8nFFfKWDSVpZpvKMRosEnxhx0WvxxOdePcvzJms0wiPWDxR6GgK7uouDsKI2lcRHNs59bqeC/kQaDB77f+EzekBfZlkuQYBR0rgfOszrXSTPsNJBvcsGx7FsPNUPflG4txRlxXc9dLoE+fbjOG77b+dGow== mariano@puntodev \n\
ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAACAQCi3vJwLtgOvsjj29vi0m/8BA/t2EBDbTMfwqyLxODawlOahmzjTkGcFV/ZIOHteX+nq1pJd6nijWNuJQKujqX56cL2UatpHZSK75Ml6QIP+PncX4CsFZHa7REx604f1CNAeqrXWAjlkav7DArZ7f4fGjzQC+hWoT8JOQYcFL8IbTswpOtq5Y/O05OgqStPH38ruo/yodFWO6CjEIBD4Plq+vzpT/Y+qp+ErSZ1WP96ikeJlwWpTSfMc+OtTb4G/mYczJMQH2du5LKoG1iGz6MNAGIKhBLvfKeFHZZK+0nTM2SQt+fkXmXTOTrM+mniBWQ3KWWZbLiu+9kvghk9tGo4P/wDd9MdmSC6nhcQZWJ4wsOUveIkUYYXW8zE4qT2FZ/totjvtJ+m8LRKh+gt69UJMPrITreUgaZuKLqFgN4SsG9zEak1eOCg69POK93BtLG0+Dd8w2iUC/EykC+UfVZHzDq2EDDjGAvmx8WjDPFPEqZGr3rc1zMV7vuLLUsOok64Qrj+lxBbXD3GeApfIUE0HVuHwMOQ543GUEVVxxG32xd65Ic+8/Cb/A2ZmzcEQBYKuc2931KvRCtQll+lBEyQaAVL5VR0Clmc7VGTkHlV36+voush+Nk/R7/PoR3x4MF1CfUCxozwdaW7aw/xhFqS/+eubWCTkeeORQNWYq+Puw== mariano@shifu.local \n\
ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABgQDID9+QZzW7P3ZvpAamvKN0GLHwzmFZ7lgH80IZ6zuGimilGkPTzQvf7zPeCqXszo5TwuuKcXLq/4JI3oR2igGLZ8eZ+jqVjZA5p65UkpLaJFF7UGZpmIjNT/KezZb43db9MCQT4i48pXrep8ofh5zbJYp18mChpThvDCo+0zUKeF8W9HXX9donEJX0mZ2XO0WMjGOA94pBaKaHFTsfD4wqYqbsSaQNVNcERb0nfDeIzEdrHj4XgKm4tKjrWymH3d/iWxGvxhkmrexh32ivRpRD5vV7psj+GKWRcax4z4V1wcDyUG6KqZZBLqUzQ06v7XRrd2mtZkfevbg78H0sSW2kAlhKlL7Ss8VXxUY49ok0UlJbreloMtt65SjxingQEIyDQOMNAsHHkqXhx7/FwSiXeVEHWs1kVoAOsAw+dBVSPw74V5JjxBuD+nJPcYrIMydVHk8a40Mu3ZPe0LV9fOg4KTepTPrimmhPNMOGzy4QZBloFw9dhEH/H4b0smXztlM= hugo@Hugos-MacBook-Pro.local \n' >> /root/.ssh/authorized_keys
RUN chmod 700 /root/.ssh && chmod 600 /root/.ssh/authorized_keys

ARG COMMIT_HASH=local
ARG CURRENT_VERSION=Unknown

ENV COMMIT_HASH=${COMMIT_HASH:-local}
ENV CURRENT_VERSION=${CURRENT_VERSION:-Unknown}

# build the app
WORKDIR /app
COPY . /app

# Create .env file to avoid runtime warnings
RUN echo "" >> .env

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
