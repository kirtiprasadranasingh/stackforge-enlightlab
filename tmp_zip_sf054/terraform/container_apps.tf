resource "azurerm_container_app_environment" "main" {
  name                       = "${var.project_name}-${var.environment}-cae"
  location                   = azurerm_resource_group.main.location
  resource_group_name        = azurerm_resource_group.main.name
  log_analytics_workspace_id = azurerm_log_analytics_workspace.main.id
  infrastructure_subnet_id   = azurerm_subnet.apps.id
  internal_load_balancer_enabled = !var.ingress_external
}

resource "azurerm_container_app" "app" {
  name                         = "${var.project_name}-${var.environment}-app"
  container_app_environment_id = azurerm_container_app_environment.main.id
  resource_group_name          = azurerm_resource_group.main.name
  revision_mode                = "Single"

  identity {
    type         = "UserAssigned"
    identity_ids = [azurerm_user_assigned_identity.app.id]
  }

  dynamic "secret" {
    for_each = var.enable_database ? [1] : []
    content {
      name                = "db-password"
      key_vault_secret_id = azurerm_key_vault_secret.db_password[0].versionless_id
      identity            = azurerm_user_assigned_identity.app.id
    }
  }

  template {
    min_replicas = var.min_replicas
    max_replicas = var.max_replicas
    container {
      name   = "app"
      image  = "${azurerm_container_registry.main.login_server}/app:latest"
      cpu    = 0.5
      memory = "1Gi"
    }
  }

  ingress {
    external_enabled = var.ingress_external
    target_port      = 8080
    traffic_weight {
      latest_revision = true
      percentage      = 100
    }
  }

  lifecycle {
    ignore_changes = [
      template[0].container[0].image,
    ]
  }
}
