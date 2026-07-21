# StackForge — QA Handoff

**Purpose:** Hand StackForge to QA for the next process gate.  
**Scope:** Generator only — does **not** provision cloud resources.  
**Bar:** Reviewable scaffolds that pass in-app **Scaffold checks** for the golden prompt matrix across AWS / GCP / Azure / Oracle.

---

## What changed for QA readiness (profile-first)

1. **Locked profiles** (auto-detected from presets + prompt):
   - `aws-ecs-express`
   - `aws-eks-helm`
   - `gcp-fastapi-cloudrun`
   - `azure-go-container-apps`
   - `oracle-oke-helm` *(new)*
2. **Seeded base files** (`lib/scaffold-base-files.ts`): after generation, StackForge fills missing required paths and **force-overwrites** fragile stubs (`main.py`, `server.js`, Dockerfiles, package manifests) with known-good `/health` stubs.
3. **Deterministic normalize** still repairs common TF/YAML/Docker mistakes (dupes, Artifact Registry URL, curl healthChecks, etc.).
4. **Validate → repair** + UI **Fix failures** (must stay in repair mode — no re-interview).
5. **Local QA matrix:** `npm run qa:matrix` (profile detect + base coverage, no Gemini).

---

## Golden prompts (run these in the UI)

Use presets as noted, then Approve & Generate, then **Run all checks**. Prefer **PASS**. If FAIL, click **Fix failures** once and re-check.

| # | Cloud | Presets | Prompt |
|---|--------|---------|--------|
| 1 | AWS ECS | AWS · ECS · GitHub Actions | `A Node.js Express REST API on AWS ECS Fargate with ALB, Redis, staging, and GitHub Actions` |
| 2 | AWS EKS | AWS · EKS · GitHub Actions | `A Node.js REST API on AWS EKS with autoscaling, a staging environment, GitHub Actions CI/CD, and a PostgreSQL database` |
| 3 | GCP | GCP · Cloud Run · GitLab CI | `A FastAPI service on GCP Cloud Run with Cloud SQL PostgreSQL, private networking, and GitLab CI` |
| 4 | Azure | Azure · Container Apps · Azure DevOps | `A Go API on Azure Container Apps with PostgreSQL Flexible Server, Key Vault, and Azure DevOps pipelines` |
| 5 | Oracle | Oracle · OKE · GitHub Actions | `A Node.js API on Oracle OKE with Helm, a public load balancer, and GitHub Actions` |

### Pass criteria (per prompt)

- [ ] Files appear for Terraform + CI + Dockerfile + app `/health` stub  
- [ ] **Run all checks** → `RESULT: PASSED` (or FAIL only on credential/plan skips marked WARN)  
- [ ] No full CRUD/ORM app in `main.py` / `server.js` / `main.go`  
- [ ] Image/registry refs look real (no invented `repository_url` on Artifact Registry)  
- [ ] **Fix failures** (if used) updates files and does **not** restart clarifying questions  
- [ ] Download ZIP opens cleanly  

### Out of scope for this QA gate

- `terraform apply` / real cloud spend  
- Production hardening sign-off  
- Every possible obscure stack combo (only the five golden prompts above are required)

---

## Local commands (engineering before/after deploy)

```bash
npm install
npm run qa:matrix          # profile + locked base coverage
# Optional: validate a fixture tree if bash + terraform available
# bash scripts/validate-scaffold.sh .verify-gcp-fastapi
```

---

## Deploy note for QA environment

QA must test the **deployed** image that includes profile-first seeding. After merge:

1. Commit + push  
2. `docker build/push` to `docker.io/kirtiprasad2003/stackforge:<tag>`  
3. `kubectl -n stackforge set image …` + rollout  
4. Confirm UI shows status like `Seeding N locked profile base file(s)…` on generate  

---

## Known residual risks (document for QA)

| Risk | Mitigation in product |
|------|------------------------|
| Model still invents invalid TF in non-stub files | validate-scaffold + auto-repair + Fix failures |
| Placeholder TF comments if completion budget expires | Warning lists missing/placeholder paths; re-run Approve |
| Rate limit on rapid check clicks | Separate validate limiter (40/min) |
| Free-form prompts outside profiles | Soft artifact set + normalize; quality lower than profiled stacks |

---

## Sign-off

| Role | Name | Date | Result |
|------|------|------|--------|
| Eng | | | |
| QA | | | Pass / Fail + notes |
