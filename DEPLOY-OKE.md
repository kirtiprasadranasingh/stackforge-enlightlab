# StackForge → existing OKE (Mumbai) + shared LB 144.24.100.85

## Confirmed from your cluster
- Region: `ap-mumbai-1` → OCIR: `bom.ocir.io`
- Ingress class: `nginx`
- Shared LB: `144.24.100.85`
- App URL: **http://stackforge.144-24-100-85.nip.io**

## A) Create OCIR repo
OCI Console → Container Registry → **Create repository** → name: `stackforge` (Private)

Click any existing repo and copy the path prefix, e.g.:
`bom.ocir.io/axxxxxxx /enlight-console` → tenancy namespace is `axxxxxxx`

## B) Build & push (laptop with Docker)

```bash
docker login bom.ocir.io
# username: <TENANCY_NAMESPACE>/<oci-username>   (or <TENANCY_NAMESPACE>/oracleidentitycloudservice/<user>)
# password: Auth Token

docker build -t bom.ocir.io/<TENANCY_NAMESPACE>/stackforge:latest .
docker push bom.ocir.io/<TENANCY_NAMESPACE>/stackforge:latest
```

(No `NEXT_BASE_PATH` — we use host-based ingress.)

## C) In Cloud Shell

```bash
git clone https://github.com/kirtiprasadranasingh/stackforge-enlightlab.git
cd stackforge-enlightlab
git pull

# 1) Edit image in k8s/deployment.yaml — replace TENANCY_NAMESPACE

# 2) Namespace + OCIR pull secret
kubectl create namespace stackforge --dry-run=client -o yaml | kubectl apply -f -

kubectl create secret docker-registry ocir-secret \
  -n stackforge \
  --docker-server=bom.ocir.io \
  --docker-username='<TENANCY_NAMESPACE>/<oci-username>' \
  --docker-password='<AUTH_TOKEN>' \
  --docker-email='you@example.com'

# 3) App secret
cp k8s/secret.yaml.example k8s/secret.yaml
# put real GEMINI_API_KEY in k8s/secret.yaml
kubectl apply -f k8s/secret.yaml

# 4) Deploy + Ingress (ClusterIP only — reuses LB)
kubectl apply -f k8s/deployment.yaml
kubectl apply -f k8s/ingress.yaml

kubectl -n stackforge rollout status deploy/stackforge
kubectl -n stackforge get pods,svc,ingress
```

## D) Open
http://stackforge.144-24-100-85.nip.io

## E) Remove later (keep cluster/LB)
```bash
kubectl delete namespace stackforge
```
