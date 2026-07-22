/** Locked GCP GKE Autopilot-style + optional Cloud SQL. */
export const TF_GKE_VERSIONS = `terraform {
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

export const TF_GKE_VARIABLES = `variable "project_id" {
  type = string
}
variable "region" {
  type    = string
  default = "us-central1"
}
variable "environment" {
  type    = string
  default = "staging"
}
variable "cluster_name" {
  type    = string
  default = "stackforge"
}
variable "enable_database" {
  type    = bool
  default = true
}
variable "db_engine" {
  type    = string
  default = "postgres"
}
`;

export const TF_GKE_MAIN = `resource "google_project_service" "apis" {
  for_each = toset([
    "container.googleapis.com",
    "compute.googleapis.com",
    "sqladmin.googleapis.com",
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
`;

export const TF_GKE_NETWORK = `resource "google_compute_network" "vpc" {
  name                    = "\${var.cluster_name}-\${var.environment}-vpc"
  auto_create_subnetworks = false
}

resource "google_compute_subnetwork" "nodes" {
  name          = "\${var.cluster_name}-\${var.environment}-nodes"
  ip_cidr_range = "10.80.0.0/20"
  region        = var.region
  network       = google_compute_network.vpc.id
}

resource "google_compute_global_address" "private_ip" {
  count         = var.enable_database ? 1 : 0
  name          = "\${var.cluster_name}-\${var.environment}-sql"
  purpose       = "VPC_PEERING"
  address_type  = "INTERNAL"
  prefix_length = 16
  network       = google_compute_network.vpc.id
}

resource "google_service_networking_connection" "private_vpc" {
  count                   = var.enable_database ? 1 : 0
  network                 = google_compute_network.vpc.id
  service                 = "servicenetworking.googleapis.com"
  reserved_peering_ranges = [google_compute_global_address.private_ip[0].name]
  depends_on              = [google_project_service.apis]
}
`;

export const TF_GKE_CLUSTER = `resource "google_container_cluster" "primary" {
  name     = "\${var.cluster_name}-\${var.environment}"
  location = var.region

  enable_autopilot = true
  network          = google_compute_network.vpc.name
  subnetwork       = google_compute_subnetwork.nodes.name

  ip_allocation_policy {
    cluster_ipv4_cidr_block  = "/16"
    services_ipv4_cidr_block = "/22"
  }

  release_channel {
    channel = "REGULAR"
  }

  depends_on = [google_project_service.apis]
}

resource "google_sql_database_instance" "main" {
  count            = var.enable_database ? 1 : 0
  name             = "\${var.cluster_name}-\${var.environment}-sql"
  region           = var.region
  database_version = var.db_engine == "mysql" ? "MYSQL_8_0" : "POSTGRES_15"
  deletion_protection = false

  settings {
    tier              = "db-custom-1-3840"
    availability_type = "REGIONAL"
    ip_configuration {
      ipv4_enabled    = false
      private_network = google_compute_network.vpc.id
    }
  }

  depends_on = [google_service_networking_connection.private_vpc]
}
`;

export const TF_GKE_OUTPUTS = `output "gke_cluster_name" {
  value = google_container_cluster.primary.name
}
output "gke_endpoint" {
  value     = google_container_cluster.primary.endpoint
  sensitive = true
}
output "sql_connection_name" {
  value = try(google_sql_database_instance.main[0].connection_name, null)
}
`;

export const TF_GKE_IAM = `# Workload Identity / CI deployer bindings — extend per environment.
# Autopilot GKE uses the runtime SA from the Helm chart serviceAccount.
`;
