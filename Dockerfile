# Portable ingestion pipeline. GitHub Actions is the cron host today, but
# every free platform eventually betrays you in some boring way — this image
# runs the identical pipeline on any container host with a cron:
#
#   docker build -t ww3watch-pipeline .
#   docker run --rm \
#     -e SUPABASE_URL -e SUPABASE_SECRET_KEY \
#     -e LLM_BASE_URL -e LLM_API_KEY -e LLM_MODEL -e LLM_MAX_RPM=2 \
#     -e FEED_PROXY_URL -e FEED_PROXY_SECRET \
#     -v ww3watch-models:/root/.cache/ww3watch-transformers \
#     ww3watch-pipeline
#
# The volume mount persists the embedding model (~280MB) between runs;
# without it every run re-downloads from Hugging Face.

FROM node:22-slim

WORKDIR /app

# .npmrc BEFORE npm ci: it carries the onnxruntime-node install-skip flags —
# without them the postinstall downloads ~300MB of CUDA binaries.
COPY .npmrc package.json package-lock.json ./
RUN npm ci --ignore-scripts=false

COPY tsconfig.json svelte.config.js vite.config.ts ./
COPY scripts ./scripts
COPY src ./src

CMD ["node", "--import", "tsx", "scripts/run-pipeline.ts"]
