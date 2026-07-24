resource "azurerm_key_vault" "main" {
  count                       = var.enable_database ? 1 : 0
  name                        = substr(replace("${var.project_name}${var.environment}kv", "-", ""), 0, 24)
  location                    = azurerm_resource_group.main.location
  resource_group_name         = azurerm_resource_group.main.name
  tenant_id                   = data.azurerm_client_config.current.tenant_id
  sku_name                    = "standard"
  soft_delete_retention_days  = 7
  purge_protection_enabled    = false
  enable_rbac_authorization   = true
}

resource "azurerm_key_vault_secret" "db_password" {
  count        = var.enable_database ? 1 : 0
  name         = "db-password"
  value        = random_password.db[0].result
  key_vault_id = azurerm_key_vault.main[0].id
}
