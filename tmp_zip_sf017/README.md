# GCP Cloud Run scaffold

Reviewable StackForge scaffold: Cloud Run, Artifact Registry, optional private
Cloud SQL or Memorystore, and one selected CI/CD pipeline. Runtime and CI/CD
files are rewritten to match the confirmed interview choices.

## Apply per environment

```bash
terraform init
terraform apply -var-file=environments/staging.tfvars -var="project_id=YOUR_PROJECT"
terraform apply -var-file=environments/development.tfvars -var="project_id=YOUR_PROJECT"
```

## Production integration required

- **Remote Terraform state:** configure a client-owned GCS backend bucket and
  state prefix before team use; bucket names, retention, and access policy are
  organization-specific and are therefore not hard-coded into this scaffold.
- **Service accounts:** the runtime account has only Cloud SQL Client when SQL
  is selected. The CI deployer needs Artifact Registry Writer, Cloud Run Admin,
  and Service Account User. Use workload identity federation where possible.
- **Private Cloud SQL:** Cloud Run reaches the private database IP through the
  generated VPC Access connector. Provide the private host and credentials via
  Secret Manager; do not expose a public database IP.
- **Rollback:** deploy a new Cloud Run revision, verify it, then route traffic
  back to the prior revision on failure. Traffic splitting/canary rollout is an
  optional client policy, not an unrequested default.

## Validation

Run `terraform fmt -check`, `terraform validate`, the selected runtime
build (for Java: `mvn package`), Docker build, and the selected CI/CD pipeline
in a non-production environment before promotion.

## Scaffold options notes

- Applied from interview: region=us-central1; envs=production; access=public_https; database=postgres; scale=high; runtime=java; ci=github-actions.
- Access is **public** (internet-facing load balancer / ingress). This locked template uses an **HTTP:80** listener by default so `terraform validate` stays certificate-free. For production HTTPS, attach a Google-managed or custom certificate and HTTPS — do not treat HTTP-only as the final product choice.
- Java was selected as the **language** only — Spring Boot / Quarkus were not confirmed. This scaffold keeps a minimal `/health` stub in a supported runtime (Node/Python/Go) so image build and probes pass. Replace the stub with your real Java service before production.
