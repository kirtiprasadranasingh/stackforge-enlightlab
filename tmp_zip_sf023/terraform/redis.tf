resource "azurerm_redis_cache" "main" {
  count                = var.enable_redis ? 1 : 0
  name                 = "${var.project_name}${var.environment}redis"
  location             = azurerm_resource_group.main.location
  resource_group_name  = azurerm_resource_group.main.name
  capacity             = var.redis_ha ? 1 : 0
  family               = var.redis_ha ? "P" : "C"
  sku_name             = var.redis_ha ? "Premium" : "Basic"
  non_ssl_port_enabled = false
  minimum_tls_version  = "1.2"
}
