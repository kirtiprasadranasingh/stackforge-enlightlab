variable "project_id" {
  type = string
}
variable "region" {
  type    = string
  default = "us-central1"
}
variable "environment" {
  type    = string
  default = "staging"
}
variable "cluster_name" {
  type    = string
  default = "stackforge"
}
variable "enable_database" {
  type    = bool
  default = false
}
variable "enable_redis" {
  type    = bool
  default = true
}
variable "redis_ha" {
  type    = bool
  default = false
}
variable "db_engine" {
  type    = string
  default = "postgres"
}
