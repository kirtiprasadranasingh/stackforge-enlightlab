output "oke_cluster_id" {

  value = oci_containerengine_cluster.oke.id
}
output "oke_cluster_name" {
  value = oci_containerengine_cluster.oke.name
}
output "vcn_id" {
  value = oci_core_vcn.main.id
}
