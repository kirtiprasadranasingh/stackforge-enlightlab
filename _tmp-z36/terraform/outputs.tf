output "alb_dns_name" {
  value = aws_lb.main.dns_name
}
output "ecr_repository_url" {
  value = aws_ecr_repository.app.repository_url
}
output "ecs_cluster_name" {
  value = aws_ecs_cluster.main.name
}
output "ecs_service_name" {
  value = aws_ecs_service.app.name
}
output "rds_endpoint" {
  value = try(aws_db_instance.main[0].address, null)
}
output "redis_endpoint" {
  value = try(aws_elasticache_cluster.redis[0].cache_nodes[0].address, null)
}
