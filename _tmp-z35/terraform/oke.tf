data "oci_identity_availability_domains" "ads" {
  compartment_id = var.tenancy_ocid
}

resource "oci_containerengine_cluster" "oke" {
  compartment_id     = var.compartment_ocid
  kubernetes_version = var.kubernetes_version
  name               = "${var.project_name}-${var.environment}-oke"
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
  name               = "${var.project_name}-${var.environment}-np"
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
