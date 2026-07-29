# StackForge QA acceptance matrix

This matrix turns the scenarios in `TEST-1.pdf` into executable acceptance
criteria. A passing case is either a **supported pass** (a truthful plan and a
contract-valid scaffold) or a **required clear block** (the product explains a
missing capability before approval). It is never acceptable to generate a plan
that promises one cloud service and code that provisions another.

## Automated gates

Run these before handing a build to QA:

```bash
npm run qa:matrix
npm run qa:options-matrix
npm run qa:contract-matrix
npx tsc --noEmit --allowImportingTsExtensions
npm run build
```

`qa:contract-matrix` covers the 7 locked profiles across 7,609 supported
runtime, data, access, scale, environment, and CI combinations. It is a
contract test: it does not require cloud credentials and does not perform an
apply. The in-app **Run all checks** must still be run on each selected ZIP.
`terraform init -backend=false` and `terraform validate` are blocking; a
credential-free `terraform plan` is correctly reported as a warning.

## TEST-1 scenario disposition

| Scenarios | Required disposition | Acceptance rule |
|---|---|---|
| 1, 2, 4–11, 13, 16–19, 22, 24, 28, 31, 32, 34–38 | Supported pass | Approved plan repeats the locked requirements; generated manifest, runtime, cloud, CI file, access, data service, environments and scale agree; all local blocking checks pass. |
| 3 (vague prompt) | Supported interview | Ask the missing requirements; do not silently choose a cloud, region or data service as client decisions. |
| 12, 21, 25, 29, 33 (cross-cloud/invalid region) | Required clear block | Ask for a valid region. Do **not** auto-map a region to a different cloud. |
| 15 (jailbreak), 17 (unrelated greeting) | Safe handling | Do not emit infrastructure files or follow instructions that override the generator contract. |
| 20 (GKE + Redis), 23 (Container Apps + Redis), 27 (OKE + Redis) | Required clear block until implemented | Redis is a valid production technology, but these locked templates do not yet provision its provider-native private service. Do not substitute another database or claim it is generated. |
| 26 (AKS + MongoDB) | Required clear block until implemented | MongoDB/Cosmos Mongo API is not a supported locked Terraform adapter. Do not replace it with PostgreSQL/MySQL. |
| 30 (OKE + PostgreSQL) | Required clear block until implemented | The OKE template must not substitute MySQL HeatWave for requested PostgreSQL. |

“Clear block” is a QA pass only when it appears before plan approval and tells
the user what is needed to continue. It is not a pass if the application shows
a complete plan and later emits a mismatched ZIP.

## Mandatory manual review for every supported prompt

1. Confirm the Requirements summary and `.stackforge/requirements.json` have
   the same cloud, host, CI, region, runtime, data choice, access mode, scale,
   and environments that QA selected.
2. Before approval, read the plan for only services the selected cloud can
   supply. A plan must not promise a custom DNS record or certificate when the
   interview did not provide a domain; it must call that a follow-up.
3. After generation, run **All checks**. A Terraform plan skip caused solely by
   absent cloud credentials is non-blocking; `terraform init` or
   `terraform validate` failure is blocking.
4. Download the ZIP and verify the requirements manifest remains unchanged.
   Check `/health`, Dockerfile port, CI file, Terraform provider, and Helm or
   platform configuration against the plan.
5. For a runtime-only choice, accept the documented minimal implementation
   default only when it matches the source files. For example, `.NET` produces
   a minimal ASP.NET Core `/health` stub; it must not be described as a
   Node/Python placeholder or as a chosen controllers/services architecture.

## Evidence to attach to a QA result

- Original prompt and selected interview answers
- Approved architecture plan
- Downloaded ZIP (including `.stackforge/requirements.json`)
- Full **All checks** output
- Any exception classified as a required clear block

