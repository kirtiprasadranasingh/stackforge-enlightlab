# AWS ECS Fargate Scaffold

Reviewable starting scaffold for Terraform + GitHub Actions + Express health stub. Not drop-in production — validate and customize before provisioning.

## Scaffold options notes

- Applied from interview: region=us-west-2; envs=development, staging, production; access=public_basic; database=mongodb; scale=high; runtime=node; ci=jenkins.
- Access is **public** (internet-facing load balancer / ingress). This locked template uses an **HTTP:80** listener by default so `terraform validate` stays certificate-free. For production HTTPS, attach an ACM (or cloud-equivalent) certificate and an HTTPS:443 listener — do not treat HTTP:80 as the final product choice.
- CI is **jenkins** only (`Jenkinsfile`). Other pipeline formats are omitted so the scaffold matches the interview choice.
- MongoDB was selected — StackForge does **not** scaffold full MongoDB/DocumentDB/Atlas infrastructure. This scaffold uses a **PostgreSQL** managed database as a validate-safe relational stand-in (`enable_database = true`, engine postgres). Replace with DocumentDB, Atlas, or your own MongoDB after review; do not treat terraform as production MongoDB.
