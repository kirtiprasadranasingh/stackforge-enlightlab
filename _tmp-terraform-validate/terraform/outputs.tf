output "cloud_run_uri" {
  value = google_cloud_run_v2_service.app.uri
}
output "artifact_registry" {
  value = local.image_url
}
output "sql_connection_name" {
  value = try(google_sql_database_instance.main[0].connection_name, null)
}
output "runtime_service_account" {
  value = google_service_account.runtime.email
}
output "gitlab_ci_service_account" {
  value = google_service_account.gitlab_ci.email
}
