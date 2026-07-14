# StackForge by Enlight Labs

Generate production-grade infrastructure code from natural language descriptions.

## What It Does

StackForge is a showcase tile that creates a coherent mini-repo from one description:

- **Terraform** — networking, compute/cluster, IAM, environments (real providers, pinned versions)
- **CI/CD** — build, quality gates, deploy, rollback targeting that infra
- **Container / orchestration** — Dockerfile + Helm / Kubernetes manifests

It is a **generator only** — it does not provision or deploy.

## Getting Started

### Prerequisites

- Node.js 18+ and npm
- A Google Gemini API key from [aistudio.google.com/apikey](https://aistudio.google.com/apikey)

### Setup

```bash
npm install
cp .env.local.example .env.local
```

Set in `.env.local`:

```
GEMINI_API_KEY=your-gemini-key
NEXT_PUBLIC_APP_URL=http://localhost:3000
NEXT_PUBLIC_DIAGNOSTIC_URL=https://enlightlabs.com/contact
```

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000)

## Requirements coverage

| ID | Requirement | Status |
|----|-------------|--------|
| FR1 | Prompt + presets | Yes |
| FR2 | Terraform + pipeline + container/K8s | Prompt-enforced |
| FR3 | Internal consistency | Prompt-enforced |
| FR4 | Real providers / pinned versions | Prompt-enforced |
| FR5 | Prod defaults (rollback, probes, IAM, secrets) | Prompt-enforced |
| FR6 | Live stream as project files | Progressive SSE + file tree |
| FR7 | Copy + ZIP | Per-file, copy-all, ZIP |
| FR8 | Stay on task | System prompt refusal |
| FR9 | Soft CTA, ungated generation | Lead capture after result |
| FR10 | Scaffold labeling | Banner + footer |

**Engine:** Google Gemini (`gemini-2.5-flash`)

## Security / cost

- Locked Origin allowlist (no wildcard)
- Rate limit per IP
- Output token + total size caps
- Secrets as `{{PLACEHOLDER}}` only

## License

© Enlight Labs. All rights reserved.
