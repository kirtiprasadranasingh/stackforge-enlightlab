output "aks_name" {
  value = azurerm_kubernetes_cluster.main.name
}
output "aks_fqdn" {
  value = azurerm_kubernetes_cluster.main.fqdn
}
output "postgres_fqdn" {
  value = try(azurerm_postgresql_flexible_server.main[0].fqdn, null)
}
