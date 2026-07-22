/** Locked Azure Container Apps + optional PostgreSQL Flexible Server. */
export const TF_ACA_VERSIONS = `terraform {
  required_version = ">= 1.5.0"
  required_providers {
    azurerm = {
      source  = "hashicorp/azurerm"
      version = "~> 4.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
  }
}

provider "azurerm" {
  features {}
}
`;

export const TF_ACA_VARIABLES = `variable "location" {
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
variable "enable_database" {
  type    = bool
  default = true
}
variable "db_ha" {
  type    = bool
  default = true
}
`;

export const TF_ACA_MAIN = `resource "azurerm_resource_group" "main" {
  name     = "\${var.project_name}-\${var.environment}-rg"
  location = var.location
}

resource "random_password" "db" {
  count   = var.enable_database ? 1 : 0
  length  = 20
  special = true
}

resource "azurerm_log_analytics_workspace" "main" {
  name                = "\${var.project_name}-\${var.environment}-logs"
  location            = azurerm_resource_group.main.location
  resource_group_name = azurerm_resource_group.main.name
  sku                 = "PerGB2018"
  retention_in_days   = 30
}

resource "azurerm_container_registry" "main" {
  name                = substr(replace("\${var.project_name}\${var.environment}acr", "-", ""), 0, 50)
  resource_group_name = azurerm_resource_group.main.name
  location            = azurerm_resource_group.main.location
  sku                 = "Basic"
  admin_enabled       = true
}
`;

export const TF_ACA_NETWORK = `resource "azurerm_virtual_network" "main" {
  name                = "\${var.project_name}-\${var.environment}-vnet"
  address_space       = ["10.60.0.0/16"]
  location            = azurerm_resource_group.main.location
  resource_group_name = azurerm_resource_group.main.name
}

resource "azurerm_subnet" "apps" {
  name                 = "apps"
  resource_group_name  = azurerm_resource_group.main.name
  virtual_network_name = azurerm_virtual_network.main.name
  address_prefixes     = ["10.60.0.0/23"]

  delegation {
    name = "aca"
    service_delegation {
      name = "Microsoft.App/environments"
      actions = [
        "Microsoft.Network/virtualNetworks/subnets/join/action",
      ]
    }
  }
}

resource "azurerm_subnet" "db" {
  count                = var.enable_database ? 1 : 0
  name                 = "db"
  resource_group_name  = azurerm_resource_group.main.name
  virtual_network_name = azurerm_virtual_network.main.name
  address_prefixes     = ["10.60.2.0/24"]
}
`;

export const TF_ACA_DATABASE = `resource "azurerm_postgresql_flexible_server" "main" {
  count                  = var.enable_database ? 1 : 0
  name                   = "\${var.project_name}-\${var.environment}-pg"
  resource_group_name    = azurerm_resource_group.main.name
  location               = azurerm_resource_group.main.location
  version                = "15"
  administrator_login    = "appuser"
  administrator_password = random_password.db[0].result
  sku_name               = var.db_ha ? "GP_Standard_D2s_v3" : "B_Standard_B1ms"
  storage_mb             = 32768
  zone                   = "1"
}

resource "azurerm_postgresql_flexible_server_database" "app" {
  count     = var.enable_database ? 1 : 0
  name      = "appdb"
  server_id = azurerm_postgresql_flexible_server.main[0].id
}
`;

export const TF_ACA_APP = `resource "azurerm_container_app_environment" "main" {
  name                       = "\${var.project_name}-\${var.environment}-cae"
  location                   = azurerm_resource_group.main.location
  resource_group_name        = azurerm_resource_group.main.name
  log_analytics_workspace_id = azurerm_log_analytics_workspace.main.id
  infrastructure_subnet_id   = azurerm_subnet.apps.id
}

resource "azurerm_container_app" "app" {
  name                         = "\${var.project_name}-\${var.environment}-app"
  container_app_environment_id = azurerm_container_app_environment.main.id
  resource_group_name          = azurerm_resource_group.main.name
  revision_mode                = "Single"

  template {
    min_replicas = 2
    max_replicas = 10
    container {
      name   = "app"
      image  = "\${azurerm_container_registry.main.login_server}/app:latest"
      cpu    = 0.5
      memory = "1Gi"
    }
  }

  ingress {
    external_enabled = true
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
`;

export const TF_ACA_OUTPUTS = `output "container_app_fqdn" {
  value = azurerm_container_app.app.ingress[0].fqdn
}
output "acr_login_server" {
  value = azurerm_container_registry.main.login_server
}
output "postgres_fqdn" {
  value = try(azurerm_postgresql_flexible_server.main[0].fqdn, null)
}
`;
