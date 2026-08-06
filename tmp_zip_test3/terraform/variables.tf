variable "project_id" {
  type = string
}
variable "region" {
  type    = string
  default = "europe-west1"
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
  default = "mysql"
}
variable "db_ha" {
  type    = bool
  default = false
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
variable "enable_redis" {
  type    = bool
  default = false
}
variable "redis_ha" {
  type    = bool
  default = false
}
variable "enable_cloud_build" {
  type        = bool
  description = "Grant the Cloud Build project service account deployment roles"
  default     = true
}
variable "min_instance_count" {
  type    = number
  default = 3
}
variable "max_instance_count" {
  type    = number
  default = 5
}
