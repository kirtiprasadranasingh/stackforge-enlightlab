# StackForge Generated Infrastructure: Azure Container Apps with MySQL (Python)

This project provides a Terraform-managed infrastructure scaffold for deploying a Python application to Azure Container Apps, backed by Azure Database for MySQL. It includes separate environments for `development` and `staging` and uses GitHub Actions for CI/CD.

## Architecture Overview

- **Cloud Provider**: Microsoft Azure
- **Compute**: Azure Container Apps
- **Database**: Azure Database for MySQL Flexible Server (private access)
- **CI/CD**: GitHub Actions
- **Networking**: Azure Virtual Network, subnets, and Private DNS Zones for secure private connectivity.
- **Security**: Azure Key Vault for secrets management and User-Assigned Managed Identities for Container Apps.
- **Environments**: Separate `development` and `staging` deployments.
- **Application**: A minimal Python HTTP server providing a `/health` endpoint.

## Getting Started

### Prerequisites

Before you begin, ensure you have the following installed and configured:

1.  **Azure CLI**: Authenticate with `az login`.
2.  **Terraform**: Version `1.5.0` or higher.
3.  **GitHub Account**: With permissions to create repositories and configure GitHub Actions secrets.
4.  **Service Principal for Azure**: Create an Azure Service Principal with `Contributor` role to the target subscription. This will be used by GitHub Actions for authentication.
    ```bash
    az ad sp create-for-rbac --name "github-actions-sp" --role "Contributor" --scopes "/subscriptions/<YOUR_SUBSCRIPTION_ID>" --json-auth
    ```
    Save the output (client-id, client-secret, tenant-id, subscription-id) for GitHub Secrets.

### 1. Terraform Setup

The Terraform configuration is organized into `terraform/` directory, with environment-specific variables in `environments/`.

#### Initialize Terraform Backend

This scaffold uses an Azure Storage Account for Terraform state. You'll need to create a resource group and storage account for this manually *once*.

```bash
# Create a resource group for your Terraform state (e.g., in westeurope)
az group create --name "tfstate-rg" --location "westeurope"

# Create a storage account for Terraform state (replace <RANDOM_SUFFIX> with a unique string)
# The storage account name must be globally unique
az storage account create --name "tfstatesa<RANDOM_SUFFIX>" --resource-group "tfstate-rg" --location "westeurope" --sku Standard_LRS --encryption-services blob

# Create a container within the storage account
az storage container create --name "tfstate" --account-name "tfstatesa<RANDOM_SUFFIX>"
```

Update `terraform/versions.tf` with your actual `resource_group_name` and `storage_account_name` in the `backend "azurerm"` block.

#### Deploy Infrastructure (Development)

1.  Navigate to the `terraform` directory:
    ```bash
    cd terraform
    ```
2.  Initialize Terraform:
    ```bash
    terraform init
    ```
3.  Review the plan for the `development` environment:
    ```bash
    terraform plan -var-file=../environments/development.tfvars
    ```
4.  Apply the changes to provision resources for `development`:
    ```bash
    terraform apply -var-file=../environments/development.tfvars
    ```

Repeat the `plan` and `apply` steps for the `staging` environment using `../environments/staging.tfvars`.

### 2. GitHub Actions Setup

This project includes a GitHub Actions workflow (`.github/workflows/deploy.yml`) to automate building, pushing, and deploying your application.

#### Configure GitHub Secrets

In your GitHub repository, go to `Settings > Secrets and variables > Actions` and add the following repository secrets based on your Service Principal output:

-   `AZURE_CLIENT_ID`: The `appId` of your Service Principal.
-   `AZURE_CLIENT_SECRET`: The `password` of your Service Principal.
-   `AZURE_TENANT_ID`: The `tenant` ID.
-   `AZURE_SUBSCRIPTION_ID`: Your Azure Subscription ID.

#### Triggering the Workflow

The workflow can be triggered in two ways:

1.  **On Push**: Pushing to `development` or `staging` branches will automatically trigger a deployment to the respective environment.
2.  **Manually**: Use the "Run workflow" button in the GitHub Actions UI and select the target `environment` (development or staging) and an optional `git_ref`.

The pipeline will:
- Validate Terraform configuration.
- Log in to Azure Container Registry (ACR).
- Build the Docker image from `Dockerfile` and push it to ACR.
- Deploy (or update) the Azure Container App.
- Include a basic rollback mechanism: if deployment fails, it attempts to activate the last known healthy revision.
- Perform a simple HTTP smoke test against the deployed `/health` endpoint.

### 3. Application Details

The `main.py` file contains a minimal Python HTTP server that responds with "OK" on the `/health` endpoint.

-   **Port**: The application listens on port `8000`, as configured in `Dockerfile` and `terraform/container_apps.tf`.
-   **Dependencies**: `requirements.txt` is provided but currently empty as no external libraries are strictly needed for the health check. Add your application's Python dependencies here.

## Rollback Strategy

The GitHub Actions workflow includes a basic rollback step. If a deployment to Azure Container Apps fails, the workflow will attempt to identify and activate the last known healthy revision of the Container App. This provides a safety mechanism to quickly revert to a stable state.

## Security Considerations

-   **Managed Identities**: The Azure Container App uses a User-Assigned Managed Identity to securely access Azure Key Vault for database credentials and to pull images from Azure Container Registry.
-   **Key Vault**: Database passwords are stored in Azure Key Vault secrets and injected into the Container App as environment variables using `key_vault_secret_id`. This prevents hardcoding sensitive information.
-   **Private MySQL**: The MySQL Flexible Server is configured with private access, reachable only from within the Virtual Network, enhancing security.
-   **Service Principal Least Privilege**: The GitHub Actions Service Principal has `Contributor` role at the subscription level for this scaffold. For production, consider scoping this down to specific resource groups or roles.

## Cleanup

To destroy the deployed infrastructure:

1.  Navigate to the `terraform` directory:
    ```bash
    cd terraform
    ```
2.  Destroy the `development` environment resources:
    ```bash
    terraform destroy -var-file=../environments/development.tfvars
    ```
3.  Destroy the `staging` environment resources:
    ```bash
    terraform destroy -var-file=../environments/staging.tfvars
    ```
4.  Optionally, delete the manually created Terraform state resource group and storage account.

## Scaffold options notes

- Applied from interview: region=westeurope; envs=development, staging; access=public_basic; database=mysql; scale=medium; runtime=python; ci=github-actions.
- Access is **public** (internet-facing load balancer / ingress). This locked template uses an **HTTP:80** listener by default so `terraform validate` stays certificate-free. For production HTTPS, attach an Application Gateway / ingress TLS certificate (Key Vault or custom) and an HTTPS listener — do not treat HTTP-only as the final product choice.
- MySQL was selected — this Azure locked template provisions a private Azure Database for MySQL Flexible Server with a delegated subnet and private DNS.
