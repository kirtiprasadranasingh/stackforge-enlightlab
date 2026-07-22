output "eks_cluster_name" {
  description = "EKS cluster name for aws eks update-kubeconfig / CI"
  value       = aws_eks_cluster.main.name
}

output "eks_cluster_endpoint" {
  description = "EKS API endpoint"
  value       = aws_eks_cluster.main.endpoint
}

output "vpc_id" {
  value = aws_vpc.main.id
}

output "private_subnet_ids" {
  value = aws_subnet.private[*].id
}

output "rds_endpoint" {
  description = "Private database endpoint (from EKS nodes only)"
  value       = try(aws_db_instance.main[0].address, null)
}

output "rds_port" {
  value = try(aws_db_instance.main[0].port, null)
}

output "db_name" {
  value = try(aws_db_instance.main[0].db_name, null)
}

output "db_username" {
  value = try(aws_db_instance.main[0].username, null)
}

output "db_password" {
  description = "Generated DB password — store in Secrets Manager before production use"
  value       = try(random_password.db[0].result, null)
  sensitive   = true
}

output "environment" {
  value = var.environment
}
