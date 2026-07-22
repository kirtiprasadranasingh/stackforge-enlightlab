variable "project_id" {
  type = string
}
variable "region" {
  type    = string
  default = "us-central1"
}
variable "service_name" {
  type    = string
  default = "stackforge-api"
}
variable "environment" {
  type    = string
  default = "staging"
}
variable "image_tag" {
  type    = string
  default = "latest"
}
variable "enable_database" {
  type    = bool
  default = true
}
variable "db_engine" {
  type    = string
  default = "postgres"
}
variable "db_ha" {
  type    = bool
  default = true
}
variable "allow_public_access" {
  type        = bool
  description = "When true, grant allUsers run.invoker (public HTTP URL)"
  default     = true
}
variable "backup_retention_count" {
  type    = number
  default = 7
}
