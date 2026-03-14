FROM emscripten/emsdk:latest

# Avoid warnings by switching to noninteractive
ENV DEBIAN_FRONTEND=noninteractive

# default username, userid and group id to use in the container.
# NOTE - scripts/docker-build.sh overrides these using current user info via command line args
ARG USERNAME=dev
ARG USER_UID=1000
ARG USER_GID=$USER_UID

# Install build tools (nvm not needed for WASM build)
RUN apt-get update \
    && apt-get -y install build-essential \
    && apt-get autoremove -y \
    && apt-get clean -y \
    && rm -rf /var/lib/apt/lists/*

RUN npm install typescript tsc -v

# Switch back to dialog for any ad-hoc use of apt-get
ENV DEBIAN_FRONTEND=dialog