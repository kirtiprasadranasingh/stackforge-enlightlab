resource "aws_db_subnet_group" "main" {
  count      = var.enable_database ? 1 : 0
  name       = "${local.name}-db"
  subnet_ids = aws_subnet.private[*].id
  tags       = local.tags
}

resource "aws_db_instance" "main" {
  count                  = var.enable_database ? 1 : 0
  identifier             = "${local.name}-db"
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
