/** Locked Azure AKS + optional PostgreSQL (Helm chart separate). */
export const TF_AKS_VERSIONS = `terraform {
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

export const TF_AKS_VARIABLES = `variable "location" {
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
variable "node_count" {
  type    = number
  default = 3
}
variable "enable_database" {
  type    = bool
  default = true
}
variable "enable_redis" {
  type    = bool
  default = false
}
variable "redis_ha" {
  type    = bool
  default = false
}
variable "availability_zones" {
  type    = list(string)
  default = ["1", "2"]
}
`;

export const TF_AKS_MAIN = `resource "azurerm_resource_group" "main" {
  name     = "\${var.project_name}-\${var.environment}-rg"
  location = var.location
}

resource "random_password" "db" {
  count   = var.enable_database ? 1 : 0
  length  = 20
  special = true
}
`;

export const TF_AKS_NETWORK = `resource "azurerm_virtual_network" "main" {
  name                = "\${var.project_name}-\${var.environment}-vnet"
  address_space       = ["10.70.0.0/16"]
  location            = azurerm_resource_group.main.location
  resource_group_name = azurerm_resource_group.main.name
}

resource "azurerm_subnet" "nodes" {
  name                 = "nodes"
  resource_group_name  = azurerm_resource_group.main.name
  virtual_network_name = azurerm_virtual_network.main.name
  address_prefixes     = ["10.70.0.0/22"]
}
`;

export const TF_AKS_CLUSTER = `resource "azurerm_kubernetes_cluster" "main" {
  name                = "\${var.project_name}-\${var.environment}-aks"
  location            = azurerm_resource_group.main.location
  resource_group_name = azurerm_resource_group.main.name
  dns_prefix          = "\${var.project_name}-\${var.environment}"

  default_node_pool {
    name           = "system"
    node_count     = var.node_count
    vm_size        = "Standard_D2s_v3"
    vnet_subnet_id = azurerm_subnet.nodes.id
    zones          = var.availability_zones
  }

  identity {
    type = "SystemAssigned"
  }

  network_profile {
    network_plugin = "azure"
    service_cidr   = "10.0.0.0/16"
    dns_service_ip = "10.0.0.10"
  }
}
`;

export const TF_AKS_DATABASE = `resource "azurerm_postgresql_flexible_server" "main" {
  count                  = var.enable_database ? 1 : 0
  name                   = "\${var.project_name}-\${var.environment}-pg"
  resource_group_name    = azurerm_resource_group.main.name
  location               = azurerm_resource_group.main.location
  version                = "15"
  administrator_login    = "appuser"
  administrator_password = random_password.db[0].result
  sku_name               = "GP_Standard_D2s_v3"
  storage {
    size_gb = 32
  }
  zone                   = var.availability_zones[0]
  public_network_access_enabled = false
}
`;

export const TF_AKS_REDIS = `resource "azurerm_redis_cache" "main" {
  count                = var.enable_redis ? 1 : 0
  name                 = "\${var.project_name}\${var.environment}redis"
  location             = azurerm_resource_group.main.location
  resource_group_name  = azurerm_resource_group.main.name
  capacity             = var.redis_ha ? 1 : 0
  family               = var.redis_ha ? "P" : "C"
  sku_name             = var.redis_ha ? "Premium" : "Basic"
  non_ssl_port_enabled = false
  minimum_tls_version  = "1.2"
}
`;

export const TF_AKS_OUTPUTS = `output "aks_name" {
  value = azurerm_kubernetes_cluster.main.name
}
output "aks_fqdn" {
  value = azurerm_kubernetes_cluster.main.fqdn
}
output "postgres_fqdn" {
  value = try(azurerm_postgresql_flexible_server.main[0].fqdn, null)
}
output "redis_hostname" {
  value = try(azurerm_redis_cache.main[0].hostname, null)
}
`;
