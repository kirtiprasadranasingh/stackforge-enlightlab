variable "region" {
  type    = string
  default = "ap-mumbai-1"
}
variable "compartment_ocid" {
  type        = string
  description = "Compartment OCID"
}
variable "tenancy_ocid" {
  type        = string
  description = "Tenancy OCID"
}
variable "project_name" {
  type    = string
  default = "stackforge"
}
variable "environment" {
  type    = string
  default = "staging"
}
variable "vcn_cidr" {
  type    = string
  default = "10.90.0.0/16"
}
variable "kubernetes_version" {
  type    = string
  default = "v1.29.1"
}
variable "node_pool_size" {
  type    = number
  default = 3
}
variable "enable_database" {
  type    = bool
  default = false
}
variable "db_engine" {
  type    = string
  default = "mysql"
}
