variable "aws_region" {
  type        = string
  description = "AWS region"
  default     = "ap-south-1"
}

variable "project_name" {
  type        = string
  description = "Project name prefix"
  default     = "stackforge"
}

variable "environment" {
  type        = string
  description = "Environment name"
  default     = "staging"

  validation {
    condition     = contains(["development", "staging", "production"], var.environment)
    error_message = "environment must be development, staging, or production."
  }
}

variable "container_port" {
  type        = number
  description = "Container listen port"
  default     = 3000
}

variable "image_tag" {
  type        = string
  description = "Container image tag deployed by CI"
  default     = "latest"
}

variable "db_username" {
  type        = string
  description = "Database master username"
  default     = "appuser"
}

variable "enable_database" {
  type        = bool
  description = "Provision managed relational database"
  default     = true
}

variable "db_engine" {
  type        = string
  description = "postgres or mysql"
  default     = "postgres"
}

variable "db_multi_az" {
  type        = bool
  default     = true
}

variable "vpc_cidr" {
  type        = string
  description = "VPC CIDR"
  default     = "10.40.0.0/16"
}

variable "node_instance_types" {
  type        = list(string)
  description = "EKS managed node instance types"
  default     = ["t3.medium"]
}

variable "node_desired_size" {
  type        = number
  description = "Desired worker nodes"
  default     = 3
}

variable "node_min_size" {
  type        = number
  default     = 2
}

variable "node_max_size" {
  type        = number
  default     = 5
}
