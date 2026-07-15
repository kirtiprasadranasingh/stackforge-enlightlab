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
