# Free-tier VM deployment

This is a parallel deployment path for an Always Free ARM64 VM. It does not
modify the existing OKE cluster. Build and test the ARM64 image first; change
DNS only after the VM health check succeeds.

## VM prerequisites

- An Always Free ARM64 VM with Docker Engine and Docker Compose plugin
- Ports 80 and 443 allowed in the OCI security list/network security group
- An A record for the chosen domain pointed to the VM public IP

## Deploy

```bash
mkdir -p ~/stackforge/deploy/vm
cd ~/stackforge/deploy/vm
# Copy compose.yaml, Caddyfile, and stackforge.env.example here.
cp stackforge.env.example stackforge.env
chmod 600 stackforge.env
# Set the real GEMINI_API_KEY and image tag in stackforge.env.
docker compose --env-file stackforge.env pull
docker compose --env-file stackforge.env up -d
docker compose ps
curl -fsS https://YOUR_DOMAIN/api/health
```

## Safe cutover

Keep the existing OKE deployment unchanged. Test the VM using a temporary
hostname first. Change the production DNS record only after the VM container
is healthy. Rolling back is a DNS change back to the current endpoint.
