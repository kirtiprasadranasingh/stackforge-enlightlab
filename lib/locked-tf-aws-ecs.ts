/** Locked validate-safe AWS ECS Fargate + optional RDS/Redis. */
export const TF_ECS_VERSIONS = `terraform {
  required_version = ">= 1.5.0"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.84"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
  }
}

provider "aws" {
  region = var.aws_region
}

data "aws_availability_zones" "available" { state = "available" }
data "aws_caller_identity" "current" {}
`;

export const TF_ECS_VARIABLES = `variable "aws_region" {
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
  default = 3
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
  default = "postgres"
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
`;

export const TF_ECS_MAIN = `locals {
  name = "\${var.project_name}-\${var.environment}"
  azs  = slice(data.aws_availability_zones.available.names, 0, 2)
  tags = {
    Project     = var.project_name
    Environment = var.environment
    ManagedBy   = "stackforge"
  }
}

resource "random_password" "db" {
  count   = var.enable_database ? 1 : 0
  length  = 20
  special = false
}
`;

export const TF_ECS_VPC = `resource "aws_vpc" "main" {
  cidr_block           = var.vpc_cidr
  enable_dns_hostnames = true
  enable_dns_support   = true
  tags                 = merge(local.tags, { Name = "\${local.name}-vpc" })
}

resource "aws_internet_gateway" "main" {
  vpc_id = aws_vpc.main.id
  tags   = merge(local.tags, { Name = "\${local.name}-igw" })
}

resource "aws_subnet" "public" {
  count                   = 2
  vpc_id                  = aws_vpc.main.id
  cidr_block              = cidrsubnet(var.vpc_cidr, 4, count.index)
  availability_zone       = local.azs[count.index]
  map_public_ip_on_launch = true
  tags                    = merge(local.tags, { Name = "\${local.name}-public-\${count.index}" })
}

resource "aws_subnet" "private" {
  count             = 2
  vpc_id            = aws_vpc.main.id
  cidr_block        = cidrsubnet(var.vpc_cidr, 4, count.index + 8)
  availability_zone = local.azs[count.index]
  tags              = merge(local.tags, { Name = "\${local.name}-private-\${count.index}" })
}

resource "aws_eip" "nat" {
  domain = "vpc"
  tags   = merge(local.tags, { Name = "\${local.name}-nat-eip" })
}

resource "aws_nat_gateway" "main" {
  allocation_id = aws_eip.nat.id
  subnet_id     = aws_subnet.public[0].id
  depends_on    = [aws_internet_gateway.main]
  tags          = merge(local.tags, { Name = "\${local.name}-nat" })
}

resource "aws_route_table" "public" {
  vpc_id = aws_vpc.main.id
  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.main.id
  }
  tags = merge(local.tags, { Name = "\${local.name}-public-rt" })
}

resource "aws_route_table_association" "public" {
  count          = 2
  subnet_id      = aws_subnet.public[count.index].id
  route_table_id = aws_route_table.public.id
}

resource "aws_route_table" "private" {
  vpc_id = aws_vpc.main.id
  route {
    cidr_block     = "0.0.0.0/0"
    nat_gateway_id = aws_nat_gateway.main.id
  }
  tags = merge(local.tags, { Name = "\${local.name}-private-rt" })
}

resource "aws_route_table_association" "private" {
  count          = 2
  subnet_id      = aws_subnet.private[count.index].id
  route_table_id = aws_route_table.private.id
}
`;

export const TF_ECS_SG = `resource "aws_security_group" "alb" {
  name_prefix = "\${local.name}-alb-"
  vpc_id      = aws_vpc.main.id
  ingress {
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = var.alb_internal ? [var.vpc_cidr] : ["0.0.0.0/0"]
  }
  ingress {
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = var.alb_internal ? [var.vpc_cidr] : ["0.0.0.0/0"]
  }
  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
  tags = local.tags
}

resource "aws_security_group" "ecs" {
  name_prefix = "\${local.name}-ecs-"
  vpc_id      = aws_vpc.main.id
  ingress {
    from_port       = var.container_port
    to_port         = var.container_port
    protocol        = "tcp"
    security_groups = [aws_security_group.alb.id]
  }
  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
  tags = local.tags
}

resource "aws_security_group" "rds" {
  count       = var.enable_database ? 1 : 0
  name_prefix = "\${local.name}-rds-"
  vpc_id      = aws_vpc.main.id
  ingress {
    from_port       = var.db_engine == "mysql" ? 3306 : 5432
    to_port         = var.db_engine == "mysql" ? 3306 : 5432
    protocol        = "tcp"
    security_groups = [aws_security_group.ecs.id]
  }
  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
  tags = local.tags
}

resource "aws_security_group" "redis" {
  count       = var.enable_redis ? 1 : 0
  name_prefix = "\${local.name}-redis-"
  vpc_id      = aws_vpc.main.id
  ingress {
    from_port       = 6379
    to_port         = 6379
    protocol        = "tcp"
    security_groups = [aws_security_group.ecs.id]
  }
  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
  tags = local.tags
}
`;

export const TF_ECS_IAM = `data "aws_iam_policy_document" "ecs_task_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["ecs-tasks.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "ecs_execution" {
  name               = "\${local.name}-ecs-exec"
  assume_role_policy = data.aws_iam_policy_document.ecs_task_assume.json
  tags               = local.tags
}

resource "aws_iam_role_policy_attachment" "ecs_execution" {
  role       = aws_iam_role.ecs_execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

resource "aws_iam_role" "ecs_task" {
  name               = "\${local.name}-ecs-task"
  assume_role_policy = data.aws_iam_policy_document.ecs_task_assume.json
  tags               = local.tags
}
`;

export const TF_ECS_ALB = `resource "aws_lb" "main" {
  name               = substr("\${local.name}-alb", 0, 32)
  internal           = var.alb_internal
  load_balancer_type = "application"
  security_groups    = [aws_security_group.alb.id]
  subnets            = var.alb_internal ? aws_subnet.private[*].id : aws_subnet.public[*].id
  tags               = local.tags
}

resource "aws_lb_target_group" "app" {
  name        = substr("\${local.name}-tg", 0, 32)
  port        = var.container_port
  protocol    = "HTTP"
  vpc_id      = aws_vpc.main.id
  target_type = "ip"
  health_check {
    path                = "/health"
    healthy_threshold   = 2
    unhealthy_threshold = 3
    matcher             = "200"
  }
  tags = local.tags
}

resource "aws_lb_listener" "http" {
  load_balancer_arn = aws_lb.main.arn
  port              = 80
  protocol          = "HTTP"
  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.app.arn
  }
}
`;

export const TF_ECS_SERVICE = `resource "aws_ecr_repository" "app" {
  name                 = "\${local.name}-app"
  image_tag_mutability = "MUTABLE"
  force_delete         = true
  tags                 = local.tags
}

resource "aws_cloudwatch_log_group" "app" {
  name              = "/ecs/\${local.name}"
  retention_in_days = 14
  tags              = local.tags
}

resource "aws_ecs_cluster" "main" {
  name = "\${local.name}"
  setting {
    name  = "containerInsights"
    value = "enabled"
  }
  tags = local.tags
}

resource "aws_ecs_task_definition" "app" {
  family                   = "\${local.name}-app"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = "256"
  memory                   = "512"
  execution_role_arn       = aws_iam_role.ecs_execution.arn
  task_role_arn            = aws_iam_role.ecs_task.arn

  container_definitions = jsonencode([{
    name      = "app"
    image     = "\${aws_ecr_repository.app.repository_url}:\${var.image_tag}"
    essential = true
    portMappings = [{
      containerPort = var.container_port
      protocol      = "tcp"
    }]
    healthCheck = {
      command     = ["CMD-SHELL", "node -e \\"require('http').get('http://127.0.0.1:'+(process.env.PORT||3000)+'/health',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1)\\""]
      interval    = 30
      timeout     = 5
      retries     = 3
      startPeriod = 20
    }
    logConfiguration = {
      logDriver = "awslogs"
      options = {
        "awslogs-group"         = aws_cloudwatch_log_group.app.name
        "awslogs-region"        = var.aws_region
        "awslogs-stream-prefix" = "app"
      }
    }
  }])
}

resource "aws_ecs_service" "app" {
  name            = "\${local.name}-app"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.app.arn
  desired_count   = var.desired_count
  launch_type     = "FARGATE"

  network_configuration {
    subnets          = aws_subnet.private[*].id
    security_groups  = [aws_security_group.ecs.id]
    assign_public_ip = false
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.app.arn
    container_name   = "app"
    container_port   = var.container_port
  }

  lifecycle {
    ignore_changes = [task_definition, desired_count]
  }

  depends_on = [aws_lb_listener.http]
  tags       = local.tags
}

resource "aws_appautoscaling_target" "ecs" {
  max_capacity       = var.desired_count >= 4 ? 20 : 10
  min_capacity       = var.desired_count >= 4 ? 3 : 2
  resource_id        = "service/\${aws_ecs_cluster.main.name}/\${aws_ecs_service.app.name}"
  scalable_dimension = "ecs:service:DesiredCount"
  service_namespace  = "ecs"
}

resource "aws_appautoscaling_policy" "ecs_cpu" {
  name               = "\${local.name}-cpu"
  policy_type        = "TargetTrackingScaling"
  resource_id        = aws_appautoscaling_target.ecs.resource_id
  scalable_dimension = aws_appautoscaling_target.ecs.scalable_dimension
  service_namespace  = aws_appautoscaling_target.ecs.service_namespace
  target_tracking_scaling_policy_configuration {
    predefined_metric_specification {
      predefined_metric_type = "ECSServiceAverageCPUUtilization"
    }
    target_value = 70
  }
}
`;

export const TF_ECS_DATABASE = `resource "aws_db_subnet_group" "main" {
  count      = var.enable_database ? 1 : 0
  name       = "\${local.name}-db"
  subnet_ids = aws_subnet.private[*].id
  tags       = local.tags
}

resource "aws_db_instance" "main" {
  count                  = var.enable_database ? 1 : 0
  identifier             = "\${local.name}-db"
  engine                 = var.db_engine == "mysql" ? "mysql" : "postgres"
  engine_version         = var.db_engine == "mysql" ? "8.0" : "15"
  instance_class         = "db.t3.medium"
  allocated_storage      = 50
  db_name                = "appdb"
  username               = var.db_username
  password               = random_password.db[0].result
  db_subnet_group_name   = aws_db_subnet_group.main[0].name
  vpc_security_group_ids = [aws_security_group.rds[0].id]
  multi_az               = var.db_multi_az
  publicly_accessible    = false
  storage_encrypted      = true
  skip_final_snapshot    = true
  backup_retention_period = 7
  tags                   = local.tags
}
`;

export const TF_ECS_REDIS = `resource "aws_elasticache_subnet_group" "main" {
  count      = var.enable_redis ? 1 : 0
  name       = "\${local.name}-redis"
  subnet_ids = aws_subnet.private[*].id
}

resource "aws_elasticache_cluster" "redis" {
  count                = var.enable_redis ? 1 : 0
  cluster_id           = substr("\${local.name}-redis", 0, 40)
  engine               = "redis"
  node_type            = "cache.t3.micro"
  num_cache_nodes      = 1
  parameter_group_name = "default.redis7"
  port                 = 6379
  subnet_group_name    = aws_elasticache_subnet_group.main[0].name
  security_group_ids   = [aws_security_group.redis[0].id]
  tags                 = local.tags
}
`;

export const TF_ECS_OUTPUTS = `output "alb_dns_name" {
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
`;
