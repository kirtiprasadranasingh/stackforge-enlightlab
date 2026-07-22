/** Locked GCP Cloud Run + optional Cloud SQL Postgres/MySQL. */
export const TF_CR_VERSIONS = `terraform {
  required_version = ">= 1.5.0"
  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 5.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
  }
}

provider "google" {
  project = var.project_id
  region  = var.region
}
`;

export const TF_CR_VARIABLES = `variable "project_id" {
  type = string
}
variable "region" {
  type    = string
  default = "us-central1"
}
variable "service_name" {
  type    = string
  default = "stackforge-api"
}
variable "environment" {
  type    = string
  default = "staging"
}
variable "image_tag" {
  type    = string
  default = "latest"
}
variable "enable_database" {
  type    = bool
  default = true
}
variable "db_engine" {
  type    = string
  default = "postgres"
}
variable "db_ha" {
  type    = bool
  default = true
}
variable "allow_public_access" {
  type        = bool
  description = "When true, grant allUsers run.invoker (public HTTP URL)"
  default     = true
}
variable "backup_retention_count" {
  type    = number
  default = 7
}
variable "enable_redis" {
  type    = bool
  default = false
}
variable "redis_ha" {
  type    = bool
  default = true
}
variable "min_instance_count" {
  type    = number
  default = 1
}
variable "max_instance_count" {
  type    = number
  default = 10
}
`;

export const TF_CR_MAIN = `resource "google_project_service" "apis" {
  for_each = toset([
    "run.googleapis.com",
    "artifactregistry.googleapis.com",
    "sqladmin.googleapis.com",
    "secretmanager.googleapis.com",
    "vpcaccess.googleapis.com",
    "servicenetworking.googleapis.com",
  ])
  project            = var.project_id
  service            = each.value
  disable_on_destroy = false
}

resource "random_password" "db" {
  count   = var.enable_database ? 1 : 0
  length  = 20
  special = false
}

resource "google_artifact_registry_repository" "docker" {
  location      = var.region
  repository_id = "\${var.service_name}-\${var.environment}"
  format        = "DOCKER"
  depends_on    = [google_project_service.apis]
}

resource "google_service_account" "runtime" {
  account_id   = substr("\${var.service_name}-\${var.environment}", 0, 28)
  display_name = "Cloud Run runtime"
}

locals {
  image_url = "\${var.region}-docker.pkg.dev/\${var.project_id}/\${google_artifact_registry_repository.docker.repository_id}/app:\${var.image_tag}"
}
`;

export const TF_CR_NETWORK = `resource "google_compute_network" "vpc" {
  name                    = "\${var.service_name}-\${var.environment}-vpc"
  auto_create_subnetworks = false
}

resource "google_compute_global_address" "private_ip" {
  count         = var.enable_database || var.enable_redis ? 1 : 0
  name          = "\${var.service_name}-\${var.environment}-sql-range"
  purpose       = "VPC_PEERING"
  address_type  = "INTERNAL"
  prefix_length = 16
  network       = google_compute_network.vpc.id
}

resource "google_service_networking_connection" "private_vpc" {
  count                   = var.enable_database || var.enable_redis ? 1 : 0
  network                 = google_compute_network.vpc.id
  service                 = "servicenetworking.googleapis.com"
  reserved_peering_ranges = [google_compute_global_address.private_ip[0].name]
  depends_on              = [google_project_service.apis]
}

resource "google_vpc_access_connector" "connector" {
  name          = substr("\${var.service_name}-\${var.environment}-conn", 0, 25)
  region        = var.region
  network       = google_compute_network.vpc.name
  ip_cidr_range = "10.8.0.0/28"
  depends_on    = [google_project_service.apis]
}
`;

export const TF_CR_DATABASE = `resource "google_sql_database_instance" "main" {
  count            = var.enable_database ? 1 : 0
  name             = "\${var.service_name}-\${var.environment}-sql"
  region           = var.region
  database_version = var.db_engine == "mysql" ? "MYSQL_8_0" : "POSTGRES_15"
  deletion_protection = false

  settings {
    tier              = "db-custom-1-3840"
    availability_type = var.db_ha ? "REGIONAL" : "ZONAL"
    backup_configuration {
      enabled                        = true
      point_in_time_recovery_enabled = true
      backup_retention_settings {
        retained_backups = var.backup_retention_count
        retention_unit   = "COUNT"
      }
    }
    ip_configuration {
      ipv4_enabled    = false
      private_network = google_compute_network.vpc.id
    }
  }

  depends_on = [google_service_networking_connection.private_vpc]
}

resource "google_sql_database" "app" {
  count    = var.enable_database ? 1 : 0
  name     = "appdb"
  instance = google_sql_database_instance.main[0].name
}

resource "google_sql_user" "app" {
  count    = var.enable_database ? 1 : 0
  name     = "appuser"
  instance = google_sql_database_instance.main[0].name
  password = random_password.db[0].result
}
`;

export const TF_CR_REDIS = `resource "google_redis_instance" "cache" {
  count          = var.enable_redis ? 1 : 0
  name           = "\${var.service_name}-\${var.environment}-redis"
  tier           = var.redis_ha ? "STANDARD_HA" : "BASIC"
  memory_size_gb = 1
  region         = var.region
  redis_version  = "REDIS_7_0"
  authorized_network = google_compute_network.vpc.id
  connect_mode   = "PRIVATE_SERVICE_ACCESS"
  depends_on     = [google_service_networking_connection.private_vpc]
}
`;

export const TF_CR_CLOUDRUN = `resource "google_cloud_run_v2_service" "app" {
  name     = "\${var.service_name}-\${var.environment}"
  location = var.region
  ingress  = var.allow_public_access ? "INGRESS_TRAFFIC_ALL" : "INGRESS_TRAFFIC_INTERNAL_ONLY"

  template {
    service_account = google_service_account.runtime.email
    scaling {
      min_instance_count = var.min_instance_count
      max_instance_count = var.max_instance_count
    }
    vpc_access {
      connector = google_vpc_access_connector.connector.id
      egress    = "PRIVATE_RANGES_ONLY"
    }
    containers {
      image = local.image_url
      ports {
        container_port = 8080
      }
      resources {
        limits = {
          cpu    = "1"
          memory = "512Mi"
        }
      }
    }
  }

  depends_on = [google_project_service.apis]
}

resource "google_cloud_run_v2_service_iam_member" "public" {
  count    = var.allow_public_access ? 1 : 0
  name     = google_cloud_run_v2_service.app.name
  location = google_cloud_run_v2_service.app.location
  role     = "roles/run.invoker"
  member   = "allUsers"
}
`;

export const TF_CR_IAM = `resource "google_service_account" "gitlab_ci" {
  account_id   = substr("\${var.service_name}-\${var.environment}-gl", 0, 28)
  display_name = "GitLab CI deployer (least privilege)"
}

resource "google_project_iam_member" "runtime_cloudsql_client" {
  count   = var.enable_database ? 1 : 0
  project = var.project_id
  role    = "roles/cloudsql.client"
  member  = "serviceAccount:\${google_service_account.runtime.email}"
}

resource "google_project_iam_member" "gitlab_artifact_writer" {
  project = var.project_id
  role    = "roles/artifactregistry.writer"
  member  = "serviceAccount:\${google_service_account.gitlab_ci.email}"
}

resource "google_project_iam_member" "gitlab_run_developer" {
  project = var.project_id
  role    = "roles/run.developer"
  member  = "serviceAccount:\${google_service_account.gitlab_ci.email}"
}

resource "google_project_iam_member" "gitlab_sa_user" {
  project = var.project_id
  role    = "roles/iam.serviceAccountUser"
  member  = "serviceAccount:\${google_service_account.gitlab_ci.email}"
}
`;

export const TF_CR_OUTPUTS = `output "cloud_run_uri" {
  value = google_cloud_run_v2_service.app.uri
}
output "artifact_registry" {
  value = local.image_url
}
output "sql_connection_name" {
  value = try(google_sql_database_instance.main[0].connection_name, null)
}
output "redis_host" {
  value = try(google_redis_instance.cache[0].host, null)
}
output "runtime_service_account" {
  value = google_service_account.runtime.email
}
output "ci_deployer_service_account" {
  value = google_service_account.gitlab_ci.email
}
`;

export const CLOUDRUN_README = `# GCP Cloud Run + FastAPI + Cloud SQL + GitLab CI

Reviewable StackForge scaffold: private Cloud SQL (Postgres), public Cloud Run URL
(no custom domain), GitLab CI build/deploy, and least-privilege IAM for runtime
and GitLab deployer service accounts.

## Apply per environment

\`\`\`bash
terraform init
terraform apply -var-file=environments/staging.tfvars -var="project_id=YOUR_PROJECT"
terraform apply -var-file=environments/development.tfvars -var="project_id=YOUR_PROJECT"
\`\`\`

Set GitLab CI variables: \`GCP_PROJECT_ID\`, \`GCP_REGION\`, \`AR_REPO\`, and workload
federation / key for \`gitlab_ci\` service account.
`;
