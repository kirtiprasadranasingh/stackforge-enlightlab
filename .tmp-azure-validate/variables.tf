variable "location" {
  type    = string
  default = "westeurope"
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
  default = 3
}
variable "enable_database" {
  type    = bool
  default = true
}
variable "enable_redis" {
  type    = bool
  default = false
}
variable "redis_ha" {
  type    = bool
  default = false
}
variable "availability_zones" {
  type    = list(string)
  default = ["1", "2"]
}
