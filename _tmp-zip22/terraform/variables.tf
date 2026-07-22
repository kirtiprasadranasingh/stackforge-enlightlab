variable "aws_region" {
  type    = string
  default = "us-east-1"
}
variable "project_name" {
  type    = string
  default = "stackforge"
}
variable "environment" {
  type    = string
  default = "staging"
}
variable "container_port" {
  type    = number
  default = 3000
}
variable "image_tag" {
  type    = string
  default = "latest"
}
variable "desired_count" {
  type    = number
  default = 2
}
variable "db_username" {
  type    = string
  default = "appuser"
}
variable "enable_database" {
  type    = bool
  default = true
}
variable "db_engine" {
  type    = string
  default = "mysql"
}
variable "db_multi_az" {
  type    = bool
  default = true
}
variable "enable_redis" {
  type    = bool
  default = false
}
variable "alb_internal" {
  type        = bool
  description = "true = private/internal ALB only"
  default     = true
}
variable "vpc_cidr" {
  type    = string
  default = "10.50.0.0/16"
}
