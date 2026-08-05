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
  role    = "roles/run.admin"
  member  = "serviceAccount:${google_service_account.gitlab_ci.email}"
}

resource "google_project_iam_member" "gitlab_sa_user" {
  project = var.project_id
  role    = "roles/iam.serviceAccountUser"
  member  = "serviceAccount:${google_service_account.gitlab_ci.email}"
}

# The Cloud Build project service account needs these permissions only when
# cloudbuild.yaml is the selected CI/CD provider.
data "google_project" "current" {
  project_id = var.project_id
}

locals {
  cloudbuild_service_account = "serviceAccount:${data.google_project.current.number}@cloudbuild.gserviceaccount.com"
}

resource "google_project_iam_member" "cloudbuild_artifact_writer" {
  count   = var.enable_cloud_build ? 1 : 0
  project = var.project_id
  role    = "roles/artifactregistry.writer"
  member  = local.cloudbuild_service_account
}

resource "google_project_iam_member" "cloudbuild_run_admin" {
  count   = var.enable_cloud_build ? 1 : 0
  project = var.project_id
  role    = "roles/run.admin"
  member  = local.cloudbuild_service_account
}

resource "google_project_iam_member" "cloudbuild_sa_user" {
  count   = var.enable_cloud_build ? 1 : 0
  project = var.project_id
  role    = "roles/iam.serviceAccountUser"
  member  = local.cloudbuild_service_account
}
