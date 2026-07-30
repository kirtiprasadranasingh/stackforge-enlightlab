# Secure .NET Web Application on Google Cloud Run with PostgreSQL

This repository contains a Terraform-managed infrastructure scaffold for a secure, internal-only .NET web application deployed on Google Cloud Run, backed by a PostgreSQL database, and integrated with GitHub Actions for CI/CD.

## Architecture Highlights

*   **Google Cloud Run**: Serverless compute for the .NET application, scaling automatically.
*   **Google Cloud SQL (PostgreSQL)**: Fully managed relational database.
*   **VPC Private Access**: Secure, internal communication between Cloud Run and Cloud SQL using VPC Access Connector and private IP.
*   **Google Artifact Registry**: Private Docker registry for application images.
*   **GitHub Actions**: Automates build, push, and deployment workflows using Workload Identity Federation for secure GCP access.
*   **.NET Health Check Stub**: A minimal .NET 6.0 application exposing a `/health` endpoint.

## Getting Started

### 1. Prerequisites

*   Google Cloud Project configured with billing enabled.
*   Terraform CLI (v1.5.0 or later) installed.
*   Git CLI installed.
*   GitHub repository for your application code.
*   `gcloud` CLI installed and authenticated to your GCP project.

### 2. Configure GCP Project

Ensure your `gcloud` CLI is configured for the target project:

```bash
gcloud config set project YOUR_GCP_PROJECT_ID
gcloud auth application-default login
```

### 3. Initialize Terraform

Navigate to the `terraform/` directory:

```bash
cd terraform/
terraform init
```

### 4. Create `staging.tfvars`

The `environments/staging.tfvars` file contains environment-specific variables.
**Sensitive values like `db_password` should ideally be managed via a secrets manager (e.g., Google Secret Manager) and passed to Terraform securely.** For this scaffold, they are defined as variables for simplicity.

Update `environments/staging.tfvars` with your project ID and desired database credentials.

```hcl
project_id  = "YOUR_GCP_PROJECT_ID"
db_username = "appuser"
db_password = "YOUR_SECURE_PASSWORD" # Replace with a strong, generated password
```

### 5. Plan and Apply Terraform

Run a Terraform plan to see the infrastructure changes:

```bash
terraform plan -var-file="../environments/staging.tfvars"
```

If the plan looks correct, apply the changes:

```bash
terraform apply -var-file="../environments/staging.tfvars"
```

This will provision the VPC, subnets, private service connection, Cloud SQL instance, Artifact Registry, Cloud Run service account, and the Cloud Run service itself.

### 6. Configure GitHub Actions OIDC

The GitHub Actions workflow uses Workload Identity Federation for secure authentication to GCP.
You need to create an IAM policy binding for your GitHub repository to assume the `github-actions-sa-staging` service account.

The `google_service_account_iam_member.github_actions_sa_wi_binding` resource in `terraform/iam.tf` currently uses a placeholder `attribute.actor/repository:${github.event.repository.full_name}`. For production, you should refine this to your specific repository and potentially specific actors (e.g., `principal://iam.googleapis.com/projects/YOUR_GCP_PROJECT_ID/locations/global/workloadIdentityPools/github-oidc-pool/subject/repo:YOUR_ORG/YOUR_REPO:ref:refs/heads/main`).

After Terraform applies, get the email of the GitHub Actions service account:
```bash
terraform output -raw github_actions_sa_email
```

In your GitHub repository settings, navigate to `Security -> Secrets and variables -> Actions -> Variables`. Add a repository variable named `GCP_PROJECT_ID` with your Google Cloud Project ID.

### 7. Run the CI/CD Pipeline

The `.github/workflows/deploy.yml` workflow will:

1.  Checkout the code.
2.  Set up .NET.
3.  Build the .NET application.
4.  Build and push the Docker image to Google Artifact Registry.
5.  Deploy the new image revision to Google Cloud Run.

Trigger the workflow manually via "Run workflow" on GitHub Actions page or push changes to your `main` branch.

## Application Health Check

The minimal .NET application provides a `/health` endpoint:

*   **GET `/health`**: Returns a 200 OK status.

To access your Cloud Run service, since it's private, you can use the `gcloud run services describe` command to get its URL and then access it via a proxy or from within your VPC (e.g., using a GCE VM).

```bash
gcloud run services describe goapp-backend-staging --region europe-west1 --format="value(status.url)"
```

## Cleanup

To destroy the infrastructure created by Terraform, run:

```bash
cd terraform/
terraform destroy -var-file="../environments/staging.tfvars"
```

**Note**: Cloud SQL instances have deletion protection enabled by default; you may need to manually disable it in the GCP Console or set `deletion_protection = false` in `terraform/database.tf` before running `terraform destroy`.

## Scaffold options notes

- Applied from interview: region=europe-west1; envs=staging; access=private; database=postgres; scale=medium; runtime=dotnet; ci=github-actions.
- Access is **private** (internal ALB / ingress disabled or private networking). Confirm VPC/VPN/private DNS before exposing the service.
- .NET was selected as the language only. This scaffold emits a minimal ASP.NET Core `/health` implementation default so the image builds and probes pass; controllers, services, and the application architecture were not selected. Replace the stub with the real service before production.
