/** Locked Oracle OKE cluster + VCN (DB optional via Autonomous note / mysql none). */
export const TF_OKE_VERSIONS = `terraform {
  required_version = ">= 1.5.0"
  required_providers {
    oci = {
      source  = "oracle/oci"
      version = "~> 6.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
  }
}

provider "oci" {
  region = var.region
}
`;

export const TF_OKE_MAIN = `# StackForge locked OKE scaffold — see network.tf, oke.tf, database.tf
`;

export const TF_OKE_IAM = `# OKE worker dynamic groups / policies — extend for workload-specific RBAC.
# Cluster and node pool IAM use OCI instance principals by default.
`;

export const TF_OKE_VARIABLES = `variable "region" {
  type    = string
  default = "ap-mumbai-1"
}
variable "compartment_ocid" {
  type        = string
  description = "Compartment OCID"
}
variable "tenancy_ocid" {
  type        = string
  description = "Tenancy OCID"
}
variable "project_name" {
  type    = string
  default = "stackforge"
}
variable "environment" {
  type    = string
  default = "staging"
}
variable "vcn_cidr" {
  type    = string
  default = "10.90.0.0/16"
}
variable "kubernetes_version" {
  type    = string
  default = "v1.29.1"
}
variable "node_pool_size" {
  type    = number
  default = 3
}
variable "enable_database" {
  type    = bool
  default = false
}
variable "db_engine" {
  type    = string
  default = "mysql"
}
`;

export const TF_OKE_NETWORK = `resource "oci_core_vcn" "main" {
  compartment_id = var.compartment_ocid
  cidr_blocks    = [var.vcn_cidr]
  display_name   = "\${var.project_name}-\${var.environment}-vcn"
  dns_label      = "stackforge"
}

resource "oci_core_internet_gateway" "igw" {
  compartment_id = var.compartment_ocid
  vcn_id         = oci_core_vcn.main.id
  display_name   = "\${var.project_name}-\${var.environment}-igw"
  enabled        = true
}

resource "oci_core_nat_gateway" "nat" {
  compartment_id = var.compartment_ocid
  vcn_id         = oci_core_vcn.main.id
  display_name   = "\${var.project_name}-\${var.environment}-nat"
}

data "oci_core_services" "all" {}

resource "oci_core_service_gateway" "sgw" {
  compartment_id = var.compartment_ocid
  vcn_id         = oci_core_vcn.main.id
  display_name   = "\${var.project_name}-\${var.environment}-sgw"
  services {
    service_id = data.oci_core_services.all.services[0].id
  }
}

resource "oci_core_route_table" "public" {
  compartment_id = var.compartment_ocid
  vcn_id         = oci_core_vcn.main.id
  display_name   = "\${var.project_name}-\${var.environment}-public-rt"
  route_rules {
    network_entity_id = oci_core_internet_gateway.igw.id
    destination       = "0.0.0.0/0"
    destination_type  = "CIDR_BLOCK"
  }
}

resource "oci_core_route_table" "private" {
  compartment_id = var.compartment_ocid
  vcn_id         = oci_core_vcn.main.id
  display_name   = "\${var.project_name}-\${var.environment}-private-rt"
  route_rules {
    network_entity_id = oci_core_nat_gateway.nat.id
    destination       = "0.0.0.0/0"
    destination_type  = "CIDR_BLOCK"
  }
  route_rules {
    network_entity_id = oci_core_service_gateway.sgw.id
    destination       = tolist(oci_core_service_gateway.sgw.services)[0].cidr_block
    destination_type  = "SERVICE_CIDR_BLOCK"
  }
}

resource "oci_core_subnet" "public" {
  compartment_id             = var.compartment_ocid
  vcn_id                     = oci_core_vcn.main.id
  cidr_block                 = cidrsubnet(var.vcn_cidr, 4, 0)
  display_name               = "\${var.project_name}-\${var.environment}-public"
  route_table_id             = oci_core_route_table.public.id
  prohibit_public_ip_on_vnic = false
}

resource "oci_core_subnet" "private" {
  compartment_id             = var.compartment_ocid
  vcn_id                     = oci_core_vcn.main.id
  cidr_block                 = cidrsubnet(var.vcn_cidr, 4, 1)
  display_name               = "\${var.project_name}-\${var.environment}-private"
  route_table_id             = oci_core_route_table.private.id
  prohibit_public_ip_on_vnic = true
}
`;

export const TF_OKE_CLUSTER = `data "oci_identity_availability_domains" "ads" {
  compartment_id = var.tenancy_ocid
}

resource "oci_containerengine_cluster" "oke" {
  compartment_id     = var.compartment_ocid
  kubernetes_version = var.kubernetes_version
  name               = "\${var.project_name}-\${var.environment}-oke"
  vcn_id             = oci_core_vcn.main.id

  options {
    service_lb_subnet_ids = [oci_core_subnet.public.id]
    kubernetes_network_config {
      pods_cidr     = "10.244.0.0/16"
      services_cidr = "10.96.0.0/16"
    }
  }
}

data "oci_containerengine_node_pool_option" "images" {
  node_pool_option_id = "all"
  compartment_id      = var.compartment_ocid
}

resource "oci_containerengine_node_pool" "workers" {
  cluster_id         = oci_containerengine_cluster.oke.id
  compartment_id     = var.compartment_ocid
  name               = "\${var.project_name}-\${var.environment}-np"
  kubernetes_version = var.kubernetes_version
  node_shape         = "VM.Standard.E4.Flex"

  node_shape_config {
    ocpus         = 2
    memory_in_gbs = 16
  }

  node_config_details {
    size = var.node_pool_size
    placement_configs {
      availability_domain = data.oci_identity_availability_domains.ads.availability_domains[0].name
      subnet_id           = oci_core_subnet.private.id
    }
  }

  node_source_details {
    image_id    = data.oci_containerengine_node_pool_option.images.sources[0].image_id
    source_type = "IMAGE"
  }
}
`;

export const TF_OKE_DATABASE = `resource "random_password" "db" {
  count   = var.enable_database ? 1 : 0
  length  = 20
  special = false
}

resource "oci_mysql_mysql_db_system" "main" {
  count              = var.enable_database && var.db_engine == "mysql" ? 1 : 0
  compartment_id     = var.compartment_ocid
  availability_domain = data.oci_identity_availability_domains.ads.availability_domains[0].name
  subnet_id          = oci_core_subnet.private.id
  display_name       = "\${var.project_name}-\${var.environment}-mysql"
  shape_name         = "MySQL.VM.Standard.E3.1.8GB"
  admin_username     = "appuser"
  admin_password     = random_password.db[0].result
  hostname_label     = "\${var.project_name}\${var.environment}mysql"
  data_storage_size_in_gb = 50
  port               = 3306
  port_x             = 33060
}
`;

export const TF_OKE_OUTPUTS = `output "oke_cluster_id" {

  value = oci_containerengine_cluster.oke.id
}
output "oke_cluster_name" {
  value = oci_containerengine_cluster.oke.name
}
output "vcn_id" {
  value = oci_core_vcn.main.id
}
`;
