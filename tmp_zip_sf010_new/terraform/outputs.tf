output "container_app_fqdn" {
  value = azurerm_container_app.app.ingress[0].fqdn
}
output "acr_login_server" {
  value = azurerm_container_registry.main.login_server
}
output "postgres_fqdn" {
  value = try(azurerm_postgresql_flexible_server.main[0].fqdn, null)
}
output "managed_identity_id" {
  value = azurerm_user_assigned_identity.app.id
}
