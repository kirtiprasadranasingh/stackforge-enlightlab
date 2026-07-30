resource "google_service_account" "gitlab_ci" {
  account_id   = substr("${var.service_name}-${var.environment}-gl", 0, 28)
  display_name = "GitLab CI deployer (least privilege)"
}

resource "google_project_iam_member" "runtime_cloudsql_client" {
  count   = var.enable_database ? 1 : 0
  project = var.project_id
  role    = "roles/cloudsql.client"
  member  = "serviceAccount:${google_service_account.runtime.email}"
}

resource "google_project_iam_member" "gitlab_artifact_writer" {
  project = var.project_id
  role    = "roles/artifactregistry.writer"
  member  = "serviceAccount:${google_service_account.gitlab_ci.email}"
}

resource "google_project_iam_member" "gitlab_run_developer" {
  project = var.project_id
  role    = "roles/run.developer"
  member  = "serviceAccount:${google_service_account.gitlab_ci.email}"
}

resource "google_project_iam_member" "gitlab_sa_user" {
  project = var.project_id
  role    = "roles/iam.serviceAccountUser"
  member  = "serviceAccount:${google_service_account.gitlab_ci.email}"
}
