# Override if Docker Hub is unreachable, e.g. --build-arg BASE_IMAGE=<your-mirror>/oven/bun:1.2.18-debian
ARG BASE_IMAGE=oven/bun:1.2.18-debian
FROM ${BASE_IMAGE}

ENV DEBIAN_FRONTEND=noninteractive \
    DISPLAY=:99 \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

# Xvfb gives Chrome a virtual screen (Turnstile rejects headless Chrome);
# x11vnc is only used by the one-time `login` command to show that screen over an SSH tunnel.
RUN apt-get update \
 && apt-get install -y --no-install-recommends xvfb x11vnc tzdata ca-certificates curl gnupg fonts-liberation \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production \
 && bunx playwright install --with-deps chrome \
 && rm -rf /var/lib/apt/lists/*

COPY src ./src
COPY docker/entrypoint.sh /usr/local/bin/entrypoint
RUN chmod +x /usr/local/bin/entrypoint \
 && mkdir -p /app/data && chown -R bun:bun /app/data

USER bun
VOLUME ["/app/data"]
ENTRYPOINT ["entrypoint"]
CMD ["start"]
