resource "google_container_cluster" "primary" {
  name     = "${var.cluster_name}-${var.environment}"
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
  name             = "${var.cluster_name}-${var.environment}-sql"
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
