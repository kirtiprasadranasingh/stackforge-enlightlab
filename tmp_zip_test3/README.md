# Google Cloud Run Java Application with MySQL and Cloud Build

This repository contains the infrastructure as code (IaC) and a minimal Java application stub to deploy a public-facing service on Google Cloud Run, backed by a Google Cloud SQL MySQL database, and automated with Google Cloud Build.

## Stack Overview

- **Cloud Provider**: Google Cloud Platform (GCP)
- **Compute**: Google Cloud Run
- **Database**: Google Cloud SQL (MySQL)
- **CI/CD**: Google Cloud Build
- **Language**: Java (minimal health check stub)
- **Environment**: Production
- **Region**: `europe-west1`
- **Access**: Public HTTPS with custom domain support

## Prerequisites

Before you begin, ensure you have the following:

1.  **Google Cloud Project**: A GCP project where you want to deploy the resources.
2.  **Billing Enabled**: Billing must be enabled for your GCP project.
3.  **gcloud CLI**: Installed and configured with your GCP project.
4.  **Terraform**: Installed (v1.5.0 or higher).
5.  **Maven**: Installed (for building the Java stub).
6.  **Custom Domain**: If you plan to use a custom domain, you need access to its DNS configuration.

## Setup and Deployment

### 1. Initialize Terraform State Backend

Update the `terraform/versions.tf` file with your desired GCS bucket for Terraform state. If you don't have one, create it:

```bash
gcloud storage buckets create gs://your-terraform-state-bucket --project=[YOUR_PROJECT_ID] --location=europe-west1
```

Then, update `terraform/versions.tf`:

```terraform
backend "gcs" {
  bucket = "your-terraform-state-bucket" # Replace with your bucket name
  prefix = "cloud-run-java-mysql/terraform-state"
}
```

### 2. Configure Terraform Variables

The `environments/production.tfvars` file contains environment-specific variables.
**Never commit sensitive data directly to version control.**

Create a `terraform.tfvars` file (or use `environments/production.tfvars` and pass it with `-var-file`) locally and populate it:

```hcl
project_id       = "your-gcp-project-id"
db_password      = "your-secure-db-password" # REPLACE with a strong password
custom_domain_name = "api.your-domain.com" # Optional: set your custom domain name
```

### 3. Enable Required Google Cloud APIs

Ensure the necessary APIs are enabled for your project:

```bash
gcloud services enable \
  artifactregistry.googleapis.com \
  cloudbuild.googleapis.com \
  run.googleapis.com \
  sqladmin.googleapis.com \
  servicenetworking.googleapis.com \
  compute.googleapis.com \
  vpcaccess.googleapis.com
```

### 4. Deploy Infrastructure with Terraform

Navigate to the `terraform/` directory:

```bash
cd terraform/
```

Initialize Terraform:

```bash
terraform init
```

Review the plan:

```bash
terraform plan -var-file=../environments/production.tfvars
```

Apply the changes:

```bash
terraform apply -var-file=../environments/production.tfvars
```

Once applied, Terraform will output resource details, including the Cloud Run service URL and Artifact Registry repository name.

### 5. Build and Deploy with Google Cloud Build

The `cloudbuild.yaml` file defines the CI/CD pipeline.

**Make sure you are in the root directory of the repository.**

Trigger a build using `gcloud builds submit`:

```bash
gcloud builds submit --config cloudbuild.yaml --project=[YOUR_PROJECT_ID] --substitutions=_REGION="europe-west1",_SERVICE_NAME="java-app",_DB_PASSWORD="your-secure-db-password",_DB_USERNAME="app_user",_DB_NAME="app_database"
```

**Important**: Replace `[YOUR_PROJECT_ID]` and `your-secure-db-password` with your actual project ID and the database password you used in Terraform. For real production, use Secret Manager for `_DB_PASSWORD`.

Cloud Build will:
1.  Build the Java application into a Docker image.
2.  Push the image to Google Artifact Registry.
3.  Deploy the new image to the Cloud Run service, injecting environment variables for database connectivity.

### 6. Configure Custom Domain (Optional)

If you specified `custom_domain_name` in your Terraform variables, Cloud Run will attempt to create the domain mapping. However, you will still need to:

1.  **Verify DNS records**: Cloud Run will provide specific DNS records (usually CNAME and TXT) that you need to add to your domain registrar's DNS settings.
2.  **Wait for propagation**: DNS changes can take some time to propagate globally.

You can check the status of your domain mapping in the GCP Console under Cloud Run -> Custom Domains.

## Application Details

The `src/main/java/com/example/health/Application.java` is a minimal Java HTTP server that listens on port `8080` and exposes a `/health` endpoint.

To build the Java application locally (for development/testing):

```bash
cd src/main/java/
mvn clean package
```

## Rollback Strategy

Google Cloud Run automatically manages revisions. If a new deployment introduces issues, you can easily roll back to a previous stable revision:

1.  **Google Cloud Console**: Navigate to your Cloud Run service, go to the "Revisions" tab, select a stable revision, and click "Manage Traffic" to direct all traffic to it.
2.  **`gcloud` CLI**:
    ```bash
    gcloud run services update-traffic [SERVICE_NAME] --to-latest --project=[YOUR_PROJECT_ID] --region=[REGION] # Example: Rollback to latest successful
    gcloud run services update-traffic [SERVICE_NAME] --to-revisions=[OLD_REVISION_NAME]=100 --project=[YOUR_PROJECT_ID] --region=[REGION] # Rollback to specific revision
    ```

## Security Considerations

-   **Secrets Management**: For true production, integrate `db_password` with Google Secret Manager and reference it in Cloud Run environment variables. This scaffold uses direct environment variable injection for simplicity.
-   **IAM Least Privilege**: The generated IAM roles adhere to the principle of least privilege. Review and adjust permissions as your application's needs evolve.
-   **Network Security**: Cloud SQL uses a private IP, restricting access to resources within your VPC, enhancing security.

## Cleanup

To destroy all resources created by Terraform (be careful, this is irreversible!):

```bash
cd terraform/
terraform destroy -var-file=../environments/production.tfvars
```

This will not delete the Artifact Registry repository or its images if they contain pushed images. You may need to manually delete them.

## Scaffold options notes

- Applied from interview: region=europe-west1; envs=production; access=public_https; database=mysql; scale=medium; runtime=java; ci=gcp-cloud-build.
- Access is **public** (internet-facing load balancer / ingress). This locked template uses an **HTTP:80** listener by default so `terraform validate` stays certificate-free. For production HTTPS, attach a Google-managed or custom certificate and HTTPS — do not treat HTTP-only as the final product choice.
- CI is **gcp-cloud-build** only (`cloudbuild.yaml`). Other pipeline formats are omitted so the scaffold matches the interview choice.
- Java was selected as the **language** only — Spring Boot / Quarkus were not confirmed. This scaffold keeps a minimal `/health` stub in a supported runtime (Node/Python/Go) so image build and probes pass. Replace the stub with your real Java service before production.
