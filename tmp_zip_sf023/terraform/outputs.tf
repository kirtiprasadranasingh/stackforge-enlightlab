output "aks_name" {
  value = azurerm_kubernetes_cluster.main.name
}
output "aks_fqdn" {
  value = azurerm_kubernetes_cluster.main.fqdn
}
output "redis_hostname" {
  value = try(azurerm_redis_cache.main[0].hostname, null)
}
