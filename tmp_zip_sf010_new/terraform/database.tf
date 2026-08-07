resource "azurerm_mysql_flexible_server" "main" {
  count                  = var.enable_database ? 1 : 0
  name                   = "${var.project_name}-${var.environment}-mysql"
  resource_group_name    = azurerm_resource_group.main.name
  location               = azurerm_resource_group.main.location
  version = "8.0.21"
  administrator_login    = "appuser"
  administrator_password = random_password.db[0].result
  sku_name               = var.db_ha ? "GP_Standard_D2s_v3" : "B_Standard_B1ms"
  storage {
    size_gb = 32
  }
  zone                   = "1"
  backup_retention_days  = var.backup_retention_days
  delegated_subnet_id    = azurerm_subnet.db[0].id
  private_dns_zone_id    = azurerm_private_dns_zone.db[0].id
  public_network_access = "Disabled"

  depends_on = [azurerm_private_dns_zone_virtual_network_link.db]
}

resource "azurerm_mysql_flexible_server_database" "app" {
  count     = var.enable_database ? 1 : 0
  name      = "appdb"
  server_id = azurerm_mysql_flexible_server.main[0].id
}
