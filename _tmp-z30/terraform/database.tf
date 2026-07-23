resource "random_password" "db" {
  count   = var.enable_database ? 1 : 0
  length  = 20
  special = false
}

resource "oci_mysql_mysql_db_system" "main" {
  count              = var.enable_database && var.db_engine == "mysql" ? 1 : 0
  compartment_id     = var.compartment_ocid
  availability_domain = data.oci_identity_availability_domains.ads.availability_domains[0].name
  subnet_id          = oci_core_subnet.private.id
  display_name       = "${var.project_name}-${var.environment}-mysql"
  shape_name         = "MySQL.VM.Standard.E3.1.8GB"
  admin_username     = "appuser"
  admin_password     = random_password.db[0].result
  hostname_label     = "${var.project_name}${var.environment}mysql"
  data_storage_size_in_gb = 50
  port               = 3306
  port_x             = 33060
}
