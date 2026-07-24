# OCI Kubernetes Engine (OKE) Application with OCI DevOps and MySQL

This scaffold provides a production-ready infrastructure setup for deploying a containerized Java application on Oracle Cloud Infrastructure (OCI) using Oracle Kubernetes Engine (OKE), managed by OCI DevOps, with a MySQL backend.

## Architecture Overview

*   **Cloud Provider**: Oracle Cloud Infrastructure (OCI)
*   **Region**: `ap-mumbai-1`
*   **Compute**: Oracle Kubernetes Engine (OKE) for container orchestration.
*   **CI/CD**: OCI DevOps for automated build, test, and deployment workflows.
*   **Language/Runtime Stub**: Java (minimal HTTP health check).
*   **Database**: OCI MySQL Database Service (managed service).
*   **Network**: Private Virtual Cloud Network (VCN) with private subnets for OKE and MySQL, ensuring internal-only access.
*   **Load Balancing**: Internal OCI Load Balancer for OKE services, restricting access within the VCN.

## Contents

*   `terraform/`: Terraform configurations for OCI infrastructure.
    *   `versions.tf`: Terraform and OCI provider versions.
    *   `variables.tf`: Input variables for Terraform.
    *   `main.tf`: Core compartment, VCN, object storage for state.
    *   `network.tf`: VCN, subnets, and security lists.
    *   `iam.tf`: IAM policies and dynamic groups for OKE and OCI DevOps.
    *   `oke.tf`: OKE cluster and node pool configuration.
    *   `mysql.tf`: OCI MySQL Database Service instance.
    *   `container_registry.tf`: OCI Container Registry setup.
    *   `load_balancer.tf`: Internal OCI Load Balancer.
    *   `outputs.tf`: Terraform output values.
*   `.oci/`: OCI DevOps pipeline definitions.
    *   `build_spec.yaml`: Build specification for building Docker images.
    *   `deploy_oke.yaml`: Deployment specification for deploying to OKE.
*   `app/`: Java health-check stub application.
    *   `Dockerfile`: Dockerfile to containerize the Java application.
    *   `pom.xml`: Maven project object model for the Java stub.
    *   `src/main/java/com/example/health/HealthCheckServer.java`: Minimal Java HTTP server.
*   `charts/app/`: Helm chart for deploying the application to OKE.
    *   `Chart.yaml`: Helm chart metadata.
    *   `values.yaml`: Default configuration values for the chart.
    *   `templates/deployment.yaml`: Kubernetes Deployment for the application.
    *   `templates/service.yaml`: Kubernetes Service to expose the application internally.
    *   `templates/hpa.yaml`: Kubernetes Horizontal Pod Autoscaler.
    *   `templates/_helpers.tpl`: Helm helper functions.

## Prerequisites

1.  **OCI Account**: An active OCI account with necessary permissions to create resources.
2.  **OCI CLI**: Configured with appropriate API keys and tenancy details.
3.  **Terraform**: Version `1.5.0` or higher installed.
4.  **Kubectl**: Configured to interact with OKE.
5.  **Helm**: Version `3.x` installed.
6.  **Maven**: For building the Java application locally (optional, as OCI DevOps handles it).

## Setup Instructions

### 1. Initialize Terraform

Navigate to the `terraform/` directory.

```bash
cd terraform/
```

Initialize Terraform. This will download the OCI provider and set up the remote backend.
*You will need to manually create an OCI Object Storage bucket and provide its name in `backend.tf` for remote state management.*

```bash
terraform init
```

### 2. Configure Variables

Edit `terraform/variables.tf` and `terraform.tfvars` (or create `dev.tfvars`, `staging.tfvars`, `prod.tfvars`) to specify your OCI tenancy details, compartment OCID, and desired resource names.

For example, create `terraform.tfvars`:

```hcl
tenancy_ocid      = "ocid1.tenancy.oc1..xxxxxx" # Replace with your tenancy OCID
compartment_ocid  = "ocid1.compartment.oc1..xxxxxx" # Replace with your compartment OCID
label_prefix      = "my-oke-app"
region            = "ap-mumbai-1"
ssh_public_key    = "ssh-rsa AAAA..." # Replace with your SSH public key for OKE worker nodes
mysql_admin_password = "SecurePassword123!" # Replace with a strong password
```

### 3. Plan and Apply Infrastructure

Review the Terraform plan to see what resources will be created.

```bash
terraform plan -var-file="terraform.tfvars"
```

Apply the Terraform configuration to provision your OCI infrastructure.

```bash
terraform apply -var-file="terraform.tfvars"
```

### 4. Configure OCI DevOps Project

1.  **Create a DevOps Project**: In the OCI Console, navigate to Developer Services > DevOps and create a new project.
2.  **Create a Code Repository**: Link your Git repository (e.g., GitHub, GitLab, OCI Code Repository) to the DevOps project.
3.  **Create an Artifact Registry Repository**: Use the OCIR repository provisioned by Terraform.
4.  **Create Build Pipeline**:
    *   Create a new Build Pipeline in your DevOps project.
    *   Add a "Managed Build" stage.
    *   Point it to `.oci/build_spec.yaml` in your repository.
    *   Configure outputs to push to OCIR.
5.  **Create Deployment Pipeline**:
    *   Create a new Deployment Pipeline.
    *   Add a "Container Instance Deployment" stage (or "Kubernetes Manifest Deployment" if available and preferred for Helm).
    *   Reference the `.oci/deploy_oke.yaml` build spec.
    *   Configure it to connect to your OKE cluster using an OKE deployment environment.

### 5. Accessing the Application

The application is deployed with an internal OCI Load Balancer. You can access it from within your OCI VCN (e.g., from another compute instance in a private subnet) using the internal IP address of the Load Balancer, which will be available in Terraform outputs.

### 6. Managing Environments (Dev, Staging, Production)

This setup supports multiple environments. You can manage them using Terraform workspaces or by having separate `tfvars` files (e.g., `dev.tfvars`, `staging.tfvars`, `prod.tfvars`) and applying them against different compartments or with different prefixes.

For OCI DevOps, you would typically create separate deployment environments in OCI DevOps for Dev, Staging, and Production OKE clusters, and then configure different deployment stages in your pipeline to target these environments.

## Rollback Strategy

The OCI DevOps `deploy_oke.yaml` includes instructions for using `helm rollback` in case of a deployment failure. This allows reverting to a previous stable release of your application on OKE.

## Secrets Management

Database credentials and other sensitive information should be stored in OCI Vault. The `deploy_oke.yaml` and Helm chart are designed to inject these secrets as environment variables into your application pods, but you will need to manually create these secrets in OCI Vault and update your OCI DevOps pipeline to fetch them.

---

This is a reviewable starting scaffold — review before provisioning; it is not drop-in production code.

## Scaffold options notes

- Applied from interview: region=ap-mumbai-1; envs=development, staging, production; access=private; database=mysql; scale=medium; runtime=java; ci=oci-devops.
- Access is **private** (internal ALB / ingress disabled or private networking). Confirm VPC/VPN/private DNS before exposing the service.
- CI is **oci-devops** only (`build_spec.yaml`). Other pipeline formats are omitted so the scaffold matches the interview choice.
- Java was selected as the **language** only — Spring Boot / Quarkus were not confirmed. This scaffold keeps a minimal `/health` stub in a supported runtime (Node/Python/Go) so image build and probes pass. Replace the stub with your real Java service before production.
