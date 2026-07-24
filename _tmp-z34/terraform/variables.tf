variable "location" {
  type    = string
  default = "eastus"
}
variable "project_name" {
  type    = string
  default = "stackforge"
}
variable "environment" {
  type    = string
  default = "staging"
}
variable "enable_database" {
  type    = bool
  default = true
}
variable "db_ha" {
  type    = bool
  default = true
}
variable "ingress_external" {
  type        = bool
  description = "false = private/internal Container Apps ingress"
  default     = false
}
variable "backup_retention_days" {
  type    = number
  default = 7
}
variable "min_replicas" {
  type    = number
  default = 2
}
variable "max_replicas" {
  type    = number
  default = 4
}
