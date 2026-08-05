# syntax=docker/dockerfile:1

FROM node:20-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:20-bookworm-slim AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
# For shared LB path routing, build with: --build-arg NEXT_BASE_PATH=/stackforge
ARG NEXT_BASE_PATH=
ENV NEXT_BASE_PATH=$NEXT_BASE_PATH
RUN npm run build

FROM node:20-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# Install dependencies (apt-get packages)
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    ca-certificates \
    git \
    unzip \
    gnupg \
    software-properties-common \
    yamllint \
  && rm -rf /var/lib/apt/lists/*

# BuildKit supplies TARGETARCH for both linux/amd64 and linux/arm64 builds.
ARG TARGETARCH

# Install Terraform for the image architecture (AMD64 locally, ARM64 on an
# Always Free Ampere A1 VM).
RUN curl --http1.1 -fsSL --retry 5 --retry-connrefused -o /tmp/terraform.zip "https://releases.hashicorp.com/terraform/1.7.5/terraform_1.7.5_linux_${TARGETARCH}.zip" \
  && unzip /tmp/terraform.zip -d /usr/local/bin/ \
  && rm /tmp/terraform.zip

# Do not bundle every cloud provider into the web image. Those plugins make the
# image several GB larger and can evict pods on small worker disks. Validation
# uses this writable cache and Terraform downloads only the selected provider.
RUN mkdir -p /tmp/stackforge-tf-plugin-cache \
  && chmod 777 /tmp/stackforge-tf-plugin-cache

# Runtime default: writable cache owned by the non-root application user.
ENV TF_PLUGIN_CACHE_DIR=/tmp/stackforge-tf-plugin-cache
ENV STACKFORGE_TF_PLUGIN_CACHE=/tmp/stackforge-tf-plugin-cache

# Install Helm (official script)
RUN curl --http1.1 -fsSL --retry 5 --retry-connrefused https://raw.githubusercontent.com/helm/helm/main/scripts/get-helm-3 | bash

# Install Hadolint for the current image architecture.
RUN case "${TARGETARCH}" in \
      amd64) HADOLINT_ARCH=x86_64 ;; \
      arm64) HADOLINT_ARCH=arm64 ;; \
      *) echo "Unsupported architecture: ${TARGETARCH}" >&2; exit 1 ;; \
    esac \
  && curl --http1.1 -sSfL --retry 5 --retry-connrefused "https://github.com/hadolint/hadolint/releases/download/v2.12.0/hadolint-Linux-${HADOLINT_ARCH}" -o /usr/local/bin/hadolint \
  && chmod +x /usr/local/bin/hadolint

# Install Actionlint
RUN curl --http1.1 -sSfL --retry 5 --retry-connrefused https://raw.githubusercontent.com/rhysd/actionlint/main/scripts/download-actionlint.bash | bash \
  && mv actionlint /usr/local/bin/

RUN addgroup --system --gid 1001 nodejs \
  && adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
# Validator script used by /api/generate auto-repair and /api/validate-scaffold
COPY --from=builder --chown=nextjs:nodejs /app/scripts ./scripts
# Strip Windows CRLF if present (breaks bash `set -o pipefail` in the container)
RUN sed -i 's/\r$//' ./scripts/*.sh && chmod +x ./scripts/*.sh

USER nextjs
EXPOSE 3000
CMD ["node", "server.js"]
