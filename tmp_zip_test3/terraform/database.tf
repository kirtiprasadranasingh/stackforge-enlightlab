resource "google_sql_database_instance" "main" {
  count            = var.enable_database ? 1 : 0
  name             = "${var.service_name}-${var.environment}-sql"
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
