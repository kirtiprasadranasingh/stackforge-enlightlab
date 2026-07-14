# StackForge - Project Documentation

## Project Overview

StackForge is an AI-powered infrastructure code generator for Enlight Labs. Users describe their desired infrastructure in natural language, and the app streams back production-grade code: Terraform, CI/CD pipelines, and Kubernetes manifests.

**Scope:** Generator only — does not provision, deploy, or manage cloud resources.

## Architecture

- **Frontend**: Next.js 16 with App Router, React 19
- **Backend**: Next.js API Routes with SSE streaming
- **AI**: Google Gemini (`gemini-2.5-flash`) via `@google/generative-ai`
- **Validation**: Zod schemas for input and output
- **Rate Limiting**: `rate-limiter-flexible` with memory store + locked origins

## Key Components

### API Endpoint (`app/api/generate/route.ts`)

- Accepts POST with `{ prompt, presets }`
- Streams Gemini events as Server-Sent Events (progressive file markers)
- Rate limits per IP; rejects non-allowlisted Origin
- Caps output tokens and total file size

### System Prompt (`lib/prompts.ts`)

- Constrains output to infra artifacts only
- Enforces real providers/versions and internal consistency
- Production defaults: rollback, probes, limits, least-privilege IAM, placeholder secrets

### Frontend (`app/page.tsx`)

- Ungated generation; soft post-result CTA
- File tree + syntax highlighting + copy / copy-all / ZIP
- Clear “reviewable starting scaffold” labeling

## Environment Variables

```
GEMINI_API_KEY=...
NEXT_PUBLIC_APP_URL=http://localhost:3000
NEXT_PUBLIC_DIAGNOSTIC_URL=https://enlightlabs.com/contact
```

## Development

```bash
npm install
cp .env.local.example .env.local   # add GEMINI_API_KEY
npm run dev
```
