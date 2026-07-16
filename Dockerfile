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

# Install Terraform (1.7.5 stable binary)
RUN curl -fsSL -o /tmp/terraform.zip "https://releases.hashicorp.com/terraform/1.7.5/terraform_1.7.5_linux_amd64.zip" \
  && unzip /tmp/terraform.zip -d /usr/local/bin/ \
  && rm /tmp/terraform.zip

# Pre-cache common Terraform providers to speed up runtime validate checks and prevent network downloads
ENV TF_PLUGIN_CACHE_DIR=/usr/share/terraform/plugin-cache
RUN mkdir -p /usr/share/terraform/plugin-cache \
  && cd /tmp \
  && printf 'terraform {\n  required_providers {\n    aws = {\n      source = "hashicorp/aws"\n      version = "~> 5.84.0"\n    }\n    google = {\n      source = "hashicorp/google"\n      version = "~> 6.0"\n    }\n    azurerm = {\n      source = "hashicorp/azurerm"\n      version = "~> 4.0"\n    }\n    kubernetes = {\n      source = "hashicorp/kubernetes"\n      version = "~> 2.30"\n    }\n    helm = {\n      source = "hashicorp/helm"\n      version = "~> 2.15"\n    }\n  }\n}\n' > prep.tf \
  && terraform init \
  && rm -f prep.tf \
  && chmod -R 777 /usr/share/terraform/plugin-cache

# Install Helm (official script)
RUN curl -fsSL https://raw.githubusercontent.com/helm/helm/main/scripts/get-helm-3 | bash

# Install Hadolint
RUN curl -sSfL https://github.com/hadolint/hadolint/releases/download/v2.12.0/hadolint-Linux-x86_64 -o /usr/local/bin/hadolint \
  && chmod +x /usr/local/bin/hadolint

# Install Actionlint
RUN curl -sSfL https://raw.githubusercontent.com/rhysd/actionlint/main/scripts/download-actionlint.bash | bash \
  && mv actionlint /usr/local/bin/

RUN addgroup --system --gid 1001 nodejs \
  && adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs
EXPOSE 3000
CMD ["node", "server.js"]
