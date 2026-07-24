locals {
  name = "${var.project_name}-${var.environment}"
  azs  = slice(data.aws_availability_zones.available.names, 0, 2)
  tags = {
    Project     = var.project_name
    Environment = var.environment
    ManagedBy   = "stackforge"
  }
}

resource "random_password" "db" {
  count   = var.enable_database ? 1 : 0
  length  = 20
  special = false
}
