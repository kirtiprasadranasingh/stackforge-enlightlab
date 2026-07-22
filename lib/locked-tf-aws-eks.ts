/**
 * Locked, validate-safe AWS EKS + PostgreSQL (Multi-AZ) Terraform.
 * Used as the profile template so checks pass AND the ZIP is useful.
 */
export const TF_EKS_VERSIONS = `terraform {
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
    kubernetes = {
      source  = "hashicorp/kubernetes"
      version = "~> 2.23"
    }
    helm = {
      source  = "hashicorp/helm"
      version = "~> 2.17"
    }
  }
}

provider "aws" {
  region = var.aws_region
}

provider "kubernetes" {
  host                   = aws_eks_cluster.main.endpoint
  cluster_ca_certificate = base64decode(aws_eks_cluster.main.certificate_authority[0].data)
  token                  = data.aws_eks_cluster_auth.main.token
}

provider "helm" {
  kubernetes {
    host                   = aws_eks_cluster.main.endpoint
    cluster_ca_certificate = base64decode(aws_eks_cluster.main.certificate_authority[0].data)
    token                  = data.aws_eks_cluster_auth.main.token
  }
}

data "aws_eks_cluster_auth" "main" {
  name = aws_eks_cluster.main.name
}

data "aws_availability_zones" "available" {
  state = "available"
}

data "aws_caller_identity" "current" {}
`;

export const TF_EKS_VARIABLES = `variable "aws_region" {
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
`;

export const TF_EKS_MAIN = `locals {
  name_prefix = "\${var.project_name}-\${var.environment}"
  azs         = slice(data.aws_availability_zones.available.names, 0, 2)
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

export const TF_EKS_NETWORK = `resource "aws_vpc" "main" {
  cidr_block           = var.vpc_cidr
  enable_dns_hostnames = true
  enable_dns_support   = true
  tags = merge(local.tags, { Name = "\${local.name_prefix}-vpc" })
}

resource "aws_internet_gateway" "main" {
  vpc_id = aws_vpc.main.id
  tags   = merge(local.tags, { Name = "\${local.name_prefix}-igw" })
}

resource "aws_subnet" "public" {
  count                   = length(local.azs)
  vpc_id                  = aws_vpc.main.id
  cidr_block              = cidrsubnet(var.vpc_cidr, 4, count.index)
  availability_zone       = local.azs[count.index]
  map_public_ip_on_launch = true
  tags = merge(local.tags, {
    Name                     = "\${local.name_prefix}-public-\${count.index}"
    "kubernetes.io/role/elb" = "1"
  })
}

resource "aws_subnet" "private" {
  count             = length(local.azs)
  vpc_id            = aws_vpc.main.id
  cidr_block        = cidrsubnet(var.vpc_cidr, 4, count.index + 8)
  availability_zone = local.azs[count.index]
  tags = merge(local.tags, {
    Name                              = "\${local.name_prefix}-private-\${count.index}"
    "kubernetes.io/role/internal-elb" = "1"
  })
}

resource "aws_eip" "nat" {
  domain = "vpc"
  tags   = merge(local.tags, { Name = "\${local.name_prefix}-nat-eip" })
}

resource "aws_nat_gateway" "main" {
  allocation_id = aws_eip.nat.id
  subnet_id     = aws_subnet.public[0].id
  tags          = merge(local.tags, { Name = "\${local.name_prefix}-nat" })
  depends_on    = [aws_internet_gateway.main]
}

resource "aws_route_table" "public" {
  vpc_id = aws_vpc.main.id
  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.main.id
  }
  tags = merge(local.tags, { Name = "\${local.name_prefix}-public-rt" })
}

resource "aws_route_table_association" "public" {
  count          = length(aws_subnet.public)
  subnet_id      = aws_subnet.public[count.index].id
  route_table_id = aws_route_table.public.id
}

resource "aws_route_table" "private" {
  vpc_id = aws_vpc.main.id
  route {
    cidr_block     = "0.0.0.0/0"
    nat_gateway_id = aws_nat_gateway.main.id
  }
  tags = merge(local.tags, { Name = "\${local.name_prefix}-private-rt" })
}

resource "aws_route_table_association" "private" {
  count          = length(aws_subnet.private)
  subnet_id      = aws_subnet.private[count.index].id
  route_table_id = aws_route_table.private.id
}
`;

export const TF_EKS_SECURITY = `resource "aws_security_group" "eks_cluster" {
  name_prefix = "\${local.name_prefix}-eks-cluster-"
  vpc_id      = aws_vpc.main.id
  description = "EKS cluster security group"
  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
  tags = merge(local.tags, { Name = "\${local.name_prefix}-eks-cluster-sg" })
}

resource "aws_security_group" "eks_nodes" {
  name_prefix = "\${local.name_prefix}-eks-nodes-"
  vpc_id      = aws_vpc.main.id
  description = "EKS worker node security group"
  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
  tags = merge(local.tags, { Name = "\${local.name_prefix}-eks-nodes-sg" })
}

resource "aws_security_group_rule" "nodes_self" {
  type                     = "ingress"
  from_port                = 0
  to_port                  = 0
  protocol                 = "-1"
  security_group_id        = aws_security_group.eks_nodes.id
  source_security_group_id = aws_security_group.eks_nodes.id
}

resource "aws_security_group_rule" "nodes_from_cluster" {
  type                     = "ingress"
  from_port                = 0
  to_port                  = 65535
  protocol                 = "tcp"
  security_group_id        = aws_security_group.eks_nodes.id
  source_security_group_id = aws_security_group.eks_cluster.id
}

resource "aws_security_group_rule" "cluster_from_nodes" {
  type                     = "ingress"
  from_port                = 443
  to_port                  = 443
  protocol                 = "tcp"
  security_group_id        = aws_security_group.eks_cluster.id
  source_security_group_id = aws_security_group.eks_nodes.id
}

resource "aws_security_group" "rds" {
  count       = var.enable_database ? 1 : 0
  name_prefix = "\${local.name_prefix}-rds-"
  vpc_id      = aws_vpc.main.id
  description = "Database access from EKS nodes only"
  ingress {
    from_port       = var.db_engine == "mysql" ? 3306 : 5432
    to_port         = var.db_engine == "mysql" ? 3306 : 5432
    protocol        = "tcp"
    security_groups = [aws_security_group.eks_nodes.id]
  }
  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
  tags = merge(local.tags, { Name = "\${local.name_prefix}-rds-sg" })
}
`;

export const TF_EKS_IAM = `data "aws_iam_policy_document" "eks_cluster_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["eks.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "eks_cluster" {
  name               = "\${local.name_prefix}-eks-cluster"
  assume_role_policy = data.aws_iam_policy_document.eks_cluster_assume.json
  tags               = local.tags
}

resource "aws_iam_role_policy_attachment" "eks_cluster_policy" {
  role       = aws_iam_role.eks_cluster.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonEKSClusterPolicy"
}

data "aws_iam_policy_document" "eks_node_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["ec2.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "eks_nodes" {
  name               = "\${local.name_prefix}-eks-nodes"
  assume_role_policy = data.aws_iam_policy_document.eks_node_assume.json
  tags               = local.tags
}

resource "aws_iam_role_policy_attachment" "eks_worker_node" {
  role       = aws_iam_role.eks_nodes.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonEKSWorkerNodePolicy"
}

resource "aws_iam_role_policy_attachment" "eks_cni" {
  role       = aws_iam_role.eks_nodes.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonEKS_CNI_Policy"
}

resource "aws_iam_role_policy_attachment" "eks_ecr_readonly" {
  role       = aws_iam_role.eks_nodes.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonEC2ContainerRegistryReadOnly"
}
`;

export const TF_EKS_CLUSTER = `resource "aws_eks_cluster" "main" {
  name     = "\${local.name_prefix}-eks"
  role_arn = aws_iam_role.eks_cluster.arn
  version  = "1.29"

  vpc_config {
    subnet_ids              = concat(aws_subnet.private[*].id, aws_subnet.public[*].id)
    endpoint_private_access = true
    endpoint_public_access  = true
    security_group_ids      = [aws_security_group.eks_cluster.id]
  }

  depends_on = [
    aws_iam_role_policy_attachment.eks_cluster_policy,
  ]

  tags = local.tags
}

resource "aws_eks_node_group" "main" {
  cluster_name    = aws_eks_cluster.main.name
  node_group_name = "\${local.name_prefix}-nodes"
  node_role_arn   = aws_iam_role.eks_nodes.arn
  subnet_ids      = aws_subnet.private[*].id
  instance_types  = var.node_instance_types

  scaling_config {
    desired_size = var.node_desired_size
    max_size     = var.node_max_size
    min_size     = var.node_min_size
  }

  update_config {
    max_unavailable = 1
  }

  depends_on = [
    aws_iam_role_policy_attachment.eks_worker_node,
    aws_iam_role_policy_attachment.eks_cni,
    aws_iam_role_policy_attachment.eks_ecr_readonly,
  ]

  tags = local.tags
}
`;

export const TF_EKS_DATABASE = `resource "aws_db_subnet_group" "main" {
  count      = var.enable_database ? 1 : 0
  name       = "\${local.name_prefix}-db"
  subnet_ids = aws_subnet.private[*].id
  tags       = merge(local.tags, { Name = "\${local.name_prefix}-db-subnets" })
}

resource "aws_db_instance" "main" {
  count                   = var.enable_database ? 1 : 0
  identifier              = "\${local.name_prefix}-db"
  engine                  = var.db_engine == "mysql" ? "mysql" : "postgres"
  engine_version          = var.db_engine == "mysql" ? "8.0" : "15"
  instance_class          = "db.t3.medium"
  allocated_storage       = 50
  max_allocated_storage   = 100
  db_name                 = "appdb"
  username                = var.db_username
  password                = random_password.db[0].result
  db_subnet_group_name    = aws_db_subnet_group.main[0].name
  vpc_security_group_ids  = [aws_security_group.rds[0].id]
  multi_az                = var.db_multi_az
  publicly_accessible     = false
  storage_encrypted       = true
  skip_final_snapshot     = true
  deletion_protection     = false
  backup_retention_period = 7
  tags                    = local.tags
}
`;

export const TF_EKS_OUTPUTS = `output "eks_cluster_name" {
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
`;

export const EKS_ENV_STAGING_TFVARS = `aws_region   = "ap-south-1"
environment  = "staging"
project_name = "stackforge"
`;

export const EKS_ENV_DEV_TFVARS = `aws_region   = "ap-south-1"
environment  = "development"
project_name = "stackforge"
`;

export const EKS_README = `# AWS EKS + Helm + PostgreSQL Scaffold

Reviewable StackForge starting scaffold for a private Node.js API on Amazon EKS
with GitHub Actions, Helm HPA, and Multi-AZ PostgreSQL (RDS).

## What is included

- VPC (public + private subnets, NAT)
- EKS cluster + managed node group (autoscaling 2–5 nodes)
- RDS PostgreSQL Multi-AZ (private, nodes-only SG)
- Helm chart with HPA (app pod autoscaling)
- GitHub Actions deploy workflow (OIDC → kubeconfig → helm upgrade)
- Minimal Express \`/health\` stub (not a full business app)

## Environments

Use separate state / var-files:

\`\`\`bash
terraform init
terraform plan  -var-file=environments/staging.tfvars
terraform apply -var-file=environments/staging.tfvars

terraform plan  -var-file=environments/development.tfvars
terraform apply -var-file=environments/development.tfvars
\`\`\`

## After apply

1. Put \`db_password\` and RDS endpoint into Kubernetes secrets / AWS Secrets Manager.
2. Set GitHub vars: \`AWS_REGION\`, \`EKS_CLUSTER_NAME\`, and secret \`AWS_ROLE_TO_ASSUME\`.
3. Point \`charts/app/values.yaml\` image.repository at your ECR repo.
4. Review IAM, network boundaries, and backup settings before production.
`;
