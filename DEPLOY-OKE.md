# StackForge on your EXISTING OKE cluster (1 shared Load Balancer)

Do **not** create a new LoadBalancer Service. We use **ClusterIP + Ingress** so StackForge shares the LB you already have (saves free-trial credits).

## What you already have
- 1 OKE cluster
- 1 Load Balancer (Ingress controller in front of apps)

## 1. Confirm cluster access

```bash
kubectl get nodes
kubectl get ingress -A
kubectl get svc -A | findstr LoadBalancer
```

Note:
- **Ingress class** (often `nginx`) — edit `k8s/ingress.yaml` if different  
- **Existing LB IP / domain**

## 2. Build & push image to OCIR

For path `/stackforge` on the shared LB (recommended with 1 LB):

```bash
docker login <region-key>.ocir.io

docker build --build-arg NEXT_BASE_PATH=/stackforge \
  -t <region-key>.ocir.io/<tenancy-namespace>/stackforge:latest .

docker push <region-key>.ocir.io/<tenancy-namespace>/stackforge:latest
```

Mumbai region key is often `bom.ocir.io`.

## 3. Image pull secret (private OCIR)

```bash
kubectl create namespace stackforge --dry-run=client -o yaml | kubectl apply -f -

kubectl create secret docker-registry ocir-secret \
  -n stackforge \
  --docker-server=<region-key>.ocir.io \
  --docker-username='<tenancy-namespace>/<oci-username>' \
  --docker-password='<AUTH_TOKEN>' \
  --docker-email='you@example.com'
```

Uncomment `imagePullSecrets` in `k8s/deployment.yaml`.

## 4. App secret

```bash
cp k8s/secret.yaml.example k8s/secret.yaml
```

Set:

```yaml
GEMINI_API_KEY: "your-key"
NEXT_PUBLIC_APP_URL: "http://<LB_IP_OR_DOMAIN>/stackforge"
ALLOWED_ORIGINS: "http://<LB_IP_OR_DOMAIN>"
NEXT_PUBLIC_DIAGNOSTIC_URL: "https://enlightlabs.com/contact"
```

```bash
kubectl apply -f k8s/secret.yaml
```

## 5. Point deployment at your image

Edit `k8s/deployment.yaml` → replace image line with your OCIR URL.

```bash
kubectl apply -f k8s/deployment.yaml
kubectl apply -f k8s/ingress.yaml
kubectl -n stackforge rollout status deploy/stackforge
kubectl -n stackforge get ingress
```

## 6. Open the app

```text
http://<EXISTING_LB_IP>/stackforge
```

If 404, check `ingressClassName` matches your cluster:

```bash
kubectl get ingressclass
```

Update `k8s/ingress.yaml` and re-apply.

## 7. Tear down only StackForge (keep cluster/LB)

```bash
kubectl delete namespace stackforge
```

## Files
- `k8s/deployment.yaml` — Deployment + **ClusterIP** Service  
- `k8s/ingress.yaml` — path `/stackforge` on shared LB  
- `k8s/secret.yaml.example` — copy to `secret.yaml` (gitignored)
