resource "google_compute_network" "vpc" {
  name                    = "${var.service_name}-${var.environment}-vpc"
  auto_create_subnetworks = false
}

resource "google_compute_global_address" "private_ip" {
  count         = var.enable_database ? 1 : 0
  name          = "${var.service_name}-${var.environment}-sql-range"
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

resource "google_vpc_access_connector" "connector" {
  name          = substr("${var.service_name}-${var.environment}-conn", 0, 25)
  region        = var.region
  network       = google_compute_network.vpc.name
  ip_cidr_range = "10.8.0.0/28"
  depends_on    = [google_project_service.apis]
}
