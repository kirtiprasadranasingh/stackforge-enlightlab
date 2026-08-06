resource "azurerm_kubernetes_cluster" "main" {
  name                = "${var.project_name}-${var.environment}-aks"
  location            = azurerm_resource_group.main.location
  resource_group_name = azurerm_resource_group.main.name
  dns_prefix          = "${var.project_name}-${var.environment}"

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
