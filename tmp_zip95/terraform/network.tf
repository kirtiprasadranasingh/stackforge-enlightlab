resource "google_compute_network" "vpc" {
  name                    = "${var.cluster_name}-${var.environment}-vpc"
  auto_create_subnetworks = false
}

resource "google_compute_subnetwork" "nodes" {
  name          = "${var.cluster_name}-${var.environment}-nodes"
  ip_cidr_range = "10.80.0.0/20"
  region        = var.region
  network       = google_compute_network.vpc.id
}

resource "google_compute_global_address" "private_ip" {
  count         = var.enable_database || var.enable_redis ? 1 : 0
  name          = "${var.cluster_name}-${var.environment}-sql"
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
