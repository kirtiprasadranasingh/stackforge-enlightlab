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
variable "node_count" {
  type    = number
  default = 4
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
  default = true
}
variable "availability_zones" {
  type    = list(string)
  default = ["1", "2"]
}
