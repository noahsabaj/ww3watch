# Portable ingestion pipeline. GitHub Actions is the cron host today, but
# every free platform eventually betrays you in some boring way — this image
# runs the identical pipeline on any container host with a cron:
#
#   docker build -t ww3watch-pipeline .
#   docker run --rm \
#     -e SUPABASE_URL -e SUPABASE_SECRET_KEY \
#     -e TYPESAFE_API_KEY \
#     -e FEED_PROXY_URL -e FEED_PROXY_SECRET \
#     -v ww3watch-models:/root/.cache/ww3watch-transformers \
#     ww3watch-pipeline
#
# The volume mount persists the embedding model (~280MB) between runs;
# without it every run re-downloads from Hugging Face.

FROM node:24-slim

WORKDIR /app

# package.json and .npmrc BEFORE npm ci: between them (allowScripts for npm 11,
# the install-skip flags for npm 10) they keep onnxruntime-node's postinstall
# from downloading ~300MB of CUDA binaries.
COPY .npmrc package.json package-lock.json ./
RUN npm ci --ignore-scripts=false

COPY tsconfig.json vite.config.ts ./
COPY scripts ./scripts
COPY src ./src

# This image is the production pipeline, so it may write to the hosted database
# (src/lib/server/write-guard.ts refuses that for local runs otherwise).
ENV WW3WATCH_ALLOW_PRODUCTION=1
CMD ["node", "--import", "tsx", "scripts/run-pipeline.ts"]
