resource "azurerm_resource_group" "main" {
  name     = "${var.project_name}-${var.environment}-rg"
  location = var.location
}

resource "random_password" "db" {
  count   = var.enable_database ? 1 : 0
  length  = 20
  special = true
}
