resource "azurerm_postgresql_flexible_server" "main" {
  count                  = var.enable_database ? 1 : 0
  name                   = "${var.project_name}-${var.environment}-pg"
  resource_group_name    = azurerm_resource_group.main.name
  location               = azurerm_resource_group.main.location
  version                = "15"
  administrator_login    = "appuser"
  administrator_password = random_password.db[0].result
  sku_name               = "GP_Standard_D2s_v3"
  storage_mb             = 32768
  zone                   = var.availability_zones[0]
  public_network_access_enabled = false
}
