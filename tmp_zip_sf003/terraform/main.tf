resource "google_project_service" "apis" {
  for_each = toset([
    "container.googleapis.com",
    "compute.googleapis.com",
    "artifactregistry.googleapis.com",
    "redis.googleapis.com",
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

resource "google_artifact_registry_repository" "app" {
  location      = var.region
  repository_id = "${var.cluster_name}-${var.environment}-images"
  description   = "Container images for the StackForge GKE application"
  format        = "DOCKER"

  depends_on = [google_project_service.apis]
}

resource "google_redis_instance" "main" {
  count              = var.enable_redis ? 1 : 0
  name               = "${var.cluster_name}-${var.environment}-redis"
  region             = var.region
  tier               = var.redis_ha ? "STANDARD_HA" : "BASIC"
  memory_size_gb     = 1
  redis_version      = "REDIS_7_0"
  authorized_network = google_compute_network.vpc.id
  connect_mode       = "PRIVATE_SERVICE_ACCESS"

  depends_on = [
    google_project_service.apis,
    google_service_networking_connection.private_vpc,
  ]
}
