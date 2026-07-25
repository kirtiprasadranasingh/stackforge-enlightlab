resource "oci_redis_redis_cluster" "main" {
  count                  = var.enable_redis ? 1 : 0
  compartment_id         = var.compartment_ocid
  display_name           = "${var.project_name}-${var.environment}-redis"
  node_count             = 2
  node_memory_in_gbs     = 2
  subnet_id              = oci_core_subnet.private.id
  software_version       = "V7_0"
}
