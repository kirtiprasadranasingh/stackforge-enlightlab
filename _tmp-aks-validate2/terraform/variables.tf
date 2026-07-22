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
