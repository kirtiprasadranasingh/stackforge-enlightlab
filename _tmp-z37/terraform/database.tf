resource "azurerm_postgresql_flexible_server" "main" {
  count                  = var.enable_database ? 1 : 0
  name                   = "${var.project_name}-${var.environment}-pg"
  resource_group_name    = azurerm_resource_group.main.name
  location               = azurerm_resource_group.main.location
  version                = "15"
  administrator_login    = "appuser"
  administrator_password = random_password.db[0].result
  sku_name               = var.db_ha ? "GP_Standard_D2s_v3" : "B_Standard_B1ms"
  storage_mb             = 32768
  zone                   = "1"
  backup_retention_days  = var.backup_retention_days
  public_network_access_enabled = false
}

resource "azurerm_postgresql_flexible_server_database" "app" {
  count     = var.enable_database ? 1 : 0
  name      = "appdb"
  server_id = azurerm_postgresql_flexible_server.main[0].id
}
