output "gke_cluster_name" {
  value = google_container_cluster.primary.name
}
output "gke_endpoint" {
  value     = google_container_cluster.primary.endpoint
  sensitive = true
}
output "artifact_registry_repository" {
  value = google_artifact_registry_repository.app.repository_id
}
output "redis_host" {
  value = try(google_redis_instance.main[0].host, null)
}
output "redis_port" {
  value = try(google_redis_instance.main[0].port, null)
}
output "sql_connection_name" {
  value = try(google_sql_database_instance.main[0].connection_name, null)
}
