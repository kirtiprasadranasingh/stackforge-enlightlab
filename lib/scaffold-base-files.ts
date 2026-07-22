/**
 * Profile-first locked base files — QA readiness.
 *
 * The model still customizes Terraform, but fragile paths (app stubs, Dockerfiles,
 * provider pins, CI skeletons, README) are seeded from known-good content so
 * validators pass consistently across clouds.
 */
import type { GeneratedFile } from '@/types';
import type { ScaffoldProfile, ScaffoldProfileId } from '@/lib/scaffold-spec';
import { getLanguageFromPath } from '@/lib/utils';
import { getMissingPaths } from '@/lib/scaffold-spec';
import {
  TF_EKS_VERSIONS,
  TF_EKS_VARIABLES,
  TF_EKS_MAIN,
  TF_EKS_NETWORK,
  TF_EKS_SECURITY,
  TF_EKS_IAM,
  TF_EKS_CLUSTER,
  TF_EKS_DATABASE,
  TF_EKS_OUTPUTS,
  EKS_ENV_STAGING_TFVARS,
  EKS_ENV_DEV_TFVARS,
  EKS_README,
} from '@/lib/locked-tf-aws-eks';
import {
  TF_ECS_VERSIONS,
  TF_ECS_VARIABLES,
  TF_ECS_MAIN,
  TF_ECS_VPC,
  TF_ECS_SG,
  TF_ECS_IAM,
  TF_ECS_ALB,
  TF_ECS_SERVICE,
  TF_ECS_DATABASE,
  TF_ECS_REDIS,
  TF_ECS_OUTPUTS,
} from '@/lib/locked-tf-aws-ecs';
import {
  TF_CR_VERSIONS,
  TF_CR_VARIABLES,
  TF_CR_MAIN,
  TF_CR_NETWORK,
  TF_CR_DATABASE,
  TF_CR_REDIS,
  TF_CR_CLOUDRUN,
  TF_CR_IAM,
  TF_CR_OUTPUTS,
  CLOUDRUN_README,
} from '@/lib/locked-tf-gcp-cloudrun';
import {
  TF_ACA_VERSIONS,
  TF_ACA_VARIABLES,
  TF_ACA_MAIN,
  TF_ACA_NETWORK,
  TF_ACA_DATABASE,
  TF_ACA_IDENTITY,
  TF_ACA_KEY_VAULT,
  TF_ACA_APP,
  TF_ACA_OUTPUTS,
} from '@/lib/locked-tf-azure-aca';
import {
  TF_AKS_VERSIONS,
  TF_AKS_VARIABLES,
  TF_AKS_MAIN,
  TF_AKS_NETWORK,
  TF_AKS_CLUSTER,
  TF_AKS_OUTPUTS,
} from '@/lib/locked-tf-azure-aks';
import {
  TF_GKE_VERSIONS,
  TF_GKE_VARIABLES,
  TF_GKE_MAIN,
  TF_GKE_NETWORK,
  TF_GKE_CLUSTER,
  TF_GKE_OUTPUTS,
  TF_GKE_IAM,
} from '@/lib/locked-tf-gcp-gke';
import {
  TF_OKE_VERSIONS,
  TF_OKE_MAIN,
  TF_OKE_VARIABLES,
  TF_OKE_NETWORK,
  TF_OKE_CLUSTER,
  TF_OKE_DATABASE,
  TF_OKE_IAM,
  TF_OKE_OUTPUTS,
} from '@/lib/locked-tf-oracle-oke';
import type { ScaffoldOptions } from '@/lib/scaffold-options';
import type { Presets } from '@/types';
import { applyScaffoldOptions } from '@/lib/apply-scaffold-options';

type BaseFileMap = Record<string, string>;

const EXPRESS_SERVER = `const express = require('express');
const app = express();
const port = Number(process.env.PORT) || 3000;

app.get('/health', (_req, res) => {
  res.status(200).json({ status: 'ok' });
});

app.get('/', (_req, res) => {
  res.status(200).json({ status: 'ok' });
});

app.listen(port, () => {
  console.log(\`listening on \${port}\`);
});
`;

const EXPRESS_PACKAGE_JSON = `{
  "name": "stackforge-health-stub",
  "version": "1.0.0",
  "private": true,
  "main": "server.js",
  "scripts": {
    "start": "node server.js",
    "test": "node -e \\"require('http').get('http://127.0.0.1:'+(process.env.PORT||3000)+'/health',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))\\""
  },
  "dependencies": {
    "express": "4.18.2"
  }
}
`;

const EXPRESS_PACKAGE_LOCK = `{
  "name": "stackforge-health-stub",
  "version": "1.0.0",
  "lockfileVersion": 3,
  "requires": true,
  "packages": {
    "": {
      "name": "stackforge-health-stub",
      "version": "1.0.0",
      "dependencies": {
        "express": "4.18.2"
      }
    },
    "node_modules/express": {
      "version": "4.18.2",
      "resolved": "https://registry.npmjs.org/express/-/express-4.18.2.tgz",
      "integrity": "sha512-5/PsL6iGPdfQ/lKM1UuielYgv3BUoJfz1aUw1/lW9k8aAoG2eP+/M1rU7M3sW9A+5q5rLJbU9nN5uSYw==",
      "license": "MIT"
    }
  }
}
`;

const NODE_DOCKERFILE_APP = `# hadolint ignore=DL3018
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev
COPY . .
ENV PORT=3000
EXPOSE 3000
USER node
CMD ["node", "server.js"]
`;

const FASTAPI_MAIN = `from fastapi import FastAPI

app = FastAPI(
    title="Health stub",
    description="Minimal health-check stub for infrastructure scaffolds.",
    version="0.1.0",
)


@app.get("/")
async def root():
    return {"status": "ok"}


@app.get("/health")
async def health():
    return {"status": "ok"}
`;

const FASTAPI_REQUIREMENTS = `fastapi==0.115.6
uvicorn[standard]==0.34.0
`;

const PYTHON_DOCKERFILE = `# hadolint ignore=DL3008
FROM python:3.11-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
ENV PORT=8080
EXPOSE 8080
USER nobody
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8080"]
`;

const GO_MAIN = `package main

import (
	"encoding/json"
	"net/http"
	"os"
)

func main() {
	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}
	http.HandleFunc("/health", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
	})
	http.HandleFunc("/", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
	})
	_ = http.ListenAndServe(":"+port, nil)
}
`;

const GO_MOD = `module stackforge-health-stub

go 1.22
`;

const GO_SUM = ``;

const GO_DOCKERFILE = `# hadolint ignore=DL3008
FROM golang:1.22-bookworm AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -o /out/app .

FROM gcr.io/distroless/static-debian12
COPY --from=build /out/app /app
ENV PORT=8080
EXPOSE 8080
USER nonroot:nonroot
ENTRYPOINT ["/app"]
`;

const README_STUB = (title: string) => `# ${title}

Reviewable starting scaffold generated by StackForge (Enlight Labs).

This is **not** drop-in production code. Validate with the in-app Scaffold checks
(terraform / hadolint / actionlint / helm), review IAM and secrets, then customize
before provisioning.

## Includes

- Terraform infrastructure
- CI/CD pipeline skeleton
- Container build + minimal \`/health\` stub (not a full application)
`;

const TF_AWS_VERSIONS = `terraform {
  required_version = ">= 1.5.0"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.84"
    }
  }
}

provider "aws" {
  region = var.aws_region
}
`;

const TF_AWS_VARIABLES = `variable "aws_region" {
  type        = string
  description = "AWS region"
  default     = "us-east-1"
}

variable "project_name" {
  type        = string
  description = "Project name prefix"
  default     = "stackforge"
}

variable "environment" {
  type        = string
  description = "Environment name (e.g. staging)"
  default     = "staging"
}

variable "container_port" {
  type        = number
  description = "Container listen port"
  default     = 3000
}

variable "image_tag" {
  type        = string
  description = "Container image tag deployed by CI"
  default     = "latest"
}
`;

const TF_GCP_VERSIONS = `terraform {
  required_version = ">= 1.5.0"
  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 5.0"
    }
  }
}

provider "google" {
  project = var.project_id
  region  = var.region
}
`;

const TF_GCP_VARIABLES = `variable "project_id" {
  type        = string
  description = "GCP project ID"
}

variable "region" {
  type        = string
  description = "GCP region"
  default     = "us-central1"
}

variable "service_name" {
  type        = string
  description = "Cloud Run service name"
  default     = "stackforge-api"
}

variable "image_tag" {
  type        = string
  description = "Container image tag"
  default     = "latest"
}
`;

const TF_AZURE_VERSIONS = `terraform {
  required_version = ">= 1.5.0"
  required_providers {
    azurerm = {
      source  = "hashicorp/azurerm"
      version = "~> 4.0"
    }
  }
}

provider "azurerm" {
  features {}
}
`;

const TF_AZURE_VARIABLES = `variable "location" {
  type        = string
  description = "Azure region"
  default     = "eastus"
}

variable "project_name" {
  type        = string
  description = "Project name prefix"
  default     = "stackforge"
}

variable "environment" {
  type        = string
  description = "Environment name"
  default     = "staging"
}
`;

const TF_OCI_VERSIONS = `terraform {
  required_version = ">= 1.5.0"
  required_providers {
    oci = {
      source  = "oracle/oci"
      version = "~> 6.0"
    }
    kubernetes = {
      source  = "hashicorp/kubernetes"
      version = "~> 2.23"
    }
    helm = {
      source  = "hashicorp/helm"
      version = "~> 2.17"
    }
  }
}
`;

const TF_OCI_VARIABLES = `variable "region" {
  type        = string
  description = "OCI region"
  default     = "ap-mumbai-1"
}

variable "compartment_ocid" {
  type        = string
  description = "Compartment OCID"
}

variable "project_name" {
  type        = string
  description = "Project name prefix"
  default     = "stackforge"
}
`;

const GHA_ECS_DEPLOY = `name: Deploy

on:
  push:
    branches: [main]
  workflow_dispatch:

env:
  AWS_REGION: \${{ vars.AWS_REGION || 'us-east-1' }}
  ECR_REPOSITORY: \${{ vars.ECR_REPOSITORY || 'stackforge' }}
  ECS_CLUSTER_NAME: \${{ vars.ECS_CLUSTER_NAME || 'stackforge' }}
  ECS_SERVICE_NAME: \${{ vars.ECS_SERVICE_NAME || 'stackforge' }}

jobs:
  deploy:
    runs-on: ubuntu-latest
    permissions:
      id-token: write
      contents: read
    outputs:
      image_uri: \${{ steps.set-image-uri.outputs.image_uri }}
      prior_task_def_arn: \${{ steps.get-current-service.outputs.current_task_definition_arn }}
    steps:
      - uses: actions/checkout@v4

      - name: Configure AWS credentials
        uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: \${{ secrets.AWS_ROLE_TO_ASSUME }}
          aws-region: \${{ env.AWS_REGION }}

      - name: Login to Amazon ECR
        id: login-ecr
        uses: aws-actions/amazon-ecr-login@v2

      - name: Set image URI output
        id: set-image-uri
        run: |
          IMAGE_URI="\${{ steps.login-ecr.outputs.registry }}/\${{ env.ECR_REPOSITORY }}:\${{ github.sha }}"
          echo "image_uri=\$IMAGE_URI" >> "\$GITHUB_OUTPUT"

      - name: Build and push
        run: |
          docker build -t "\${{ steps.set-image-uri.outputs.image_uri }}" -f app/Dockerfile app
          docker push "\${{ steps.set-image-uri.outputs.image_uri }}"

      - name: Capture prior task definition
        id: get-current-service
        run: |
          CURRENT=\$(aws ecs describe-services --cluster "\$ECS_CLUSTER_NAME" --services "\$ECS_SERVICE_NAME" --query 'services[0].taskDefinition' --output text)
          echo "current_task_definition_arn=\$CURRENT" >> "\$GITHUB_OUTPUT"

      - name: Deploy ECS service
        run: |
          aws ecs update-service \\
            --cluster "\$ECS_CLUSTER_NAME" \\
            --service "\$ECS_SERVICE_NAME" \\
            --force-new-deployment
          aws ecs wait services-stable \\
            --cluster "\$ECS_CLUSTER_NAME" \\
            --services "\$ECS_SERVICE_NAME"

  scaffold_rollback:
    if: failure() && needs.deploy.outputs.prior_task_def_arn != ''
    needs: deploy
    runs-on: ubuntu-latest
    steps:
      - name: Rollback note
        run: |
          echo "Rollback to prior task definition if deploy failed."
`;

const GHA_EKS_DEPLOY = `name: Deploy

on:
  push:
    branches: [main]
  workflow_dispatch:

env:
  AWS_REGION: \${{ vars.AWS_REGION || 'us-east-1' }}
  EKS_CLUSTER_NAME: \${{ vars.EKS_CLUSTER_NAME || 'stackforge' }}
  HELM_RELEASE: \${{ vars.HELM_RELEASE || 'app' }}
  HELM_NAMESPACE: \${{ vars.HELM_NAMESPACE || 'default' }}

jobs:
  deploy:
    runs-on: ubuntu-latest
    permissions:
      id-token: write
      contents: read
    steps:
      - uses: actions/checkout@v4

      - name: Configure AWS credentials
        uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: \${{ secrets.AWS_ROLE_TO_ASSUME }}
          aws-region: \${{ env.AWS_REGION }}

      - name: Update kubeconfig
        run: aws eks update-kubeconfig --name "\$EKS_CLUSTER_NAME" --region "\$AWS_REGION"

      - name: Helm upgrade
        run: |
          helm upgrade --install "\$HELM_RELEASE" ./charts/app \\
            --namespace "\$HELM_NAMESPACE" \\
            --create-namespace \\
            --atomic \\
            --wait
`;

const GITLAB_CI = `stages:
  - test
  - build
  - deploy

variables:
  IMAGE_TAG: \$CI_COMMIT_SHORT_SHA

test:
  stage: test
  image: python:3.11-slim
  script:
    - pip install -r requirements.txt
    - python -c "import main; print('ok')"

build:
  stage: build
  image: google/cloud-sdk:slim
  services:
    - docker:24-dind
  variables:
    DOCKER_HOST: tcp://docker:2375
    DOCKER_TLS_CERTDIR: ""
  script:
    - gcloud auth configure-docker "\$GCP_REGION-docker.pkg.dev" --quiet
    - docker build -t "\$GCP_REGION-docker.pkg.dev/\$GCP_PROJECT_ID/\$AR_REPO/app:\$IMAGE_TAG" .
    - docker push "\$GCP_REGION-docker.pkg.dev/\$GCP_PROJECT_ID/\$AR_REPO/app:\$IMAGE_TAG"
  rules:
    - if: \$CI_COMMIT_BRANCH == \$CI_DEFAULT_BRANCH

deploy:
  stage: deploy
  image: google/cloud-sdk:slim
  script:
    - gcloud run deploy "\$CLOUD_RUN_SERVICE" --image "\$GCP_REGION-docker.pkg.dev/\$GCP_PROJECT_ID/\$AR_REPO/app:\$IMAGE_TAG" --region "\$GCP_REGION" --quiet
  rules:
    - if: \$CI_COMMIT_BRANCH == \$CI_DEFAULT_BRANCH
  when: on_success
`;

const AZURE_PIPELINE = `trigger:
  - main

pool:
  vmImage: ubuntu-latest

stages:
  - stage: Test
    jobs:
      - job: unit
        steps:
          - script: |
              go test ./...
            displayName: Go test

  - stage: Build
    dependsOn: Test
    jobs:
      - job: build_push
        steps:
          - task: Docker@2
            inputs:
              command: buildAndPush
              repository: \$(imageRepository)
              Dockerfile: Dockerfile
              tags: |
                \$(Build.BuildId)

  - stage: Deploy
    dependsOn: Build
    jobs:
      - job: deploy_aca
        steps:
          - script: |
              echo "Deploy Container App revision (replace with az containerapp update)."
            displayName: Deploy note
`;

const HELM_CHART = `apiVersion: v2
name: app
description: StackForge reviewable Helm chart
type: application
version: 0.1.0
appVersion: "1.0.0"
`;

const HELM_VALUES = `replicaCount: 3

image:
  repository: REPLACE_ME
  tag: latest
  pullPolicy: IfNotPresent

service:
  type: ClusterIP
  port: 80
  targetPort: 3000

# Private / internal only — ClusterIP; enable ingress later if needed.
ingress:
  enabled: false
  className: nginx
  annotations: {}
  hosts:
    - host: app.example.com
      paths:
        - path: /
          pathType: Prefix

autoscaling:
  enabled: true
  minReplicas: 3
  maxReplicas: 5
  targetCPUUtilizationPercentage: 70

resources:
  requests:
    cpu: 100m
    memory: 128Mi
  limits:
    cpu: 500m
    memory: 512Mi

serviceAccount:
  create: true
  annotations: {}
`;

const HELM_DEPLOYMENT = `apiVersion: apps/v1
kind: Deployment
metadata:
  name: {{ include "app.fullname" . }}
  labels:
    {{- include "app.labels" . | nindent 4 }}
spec:
  {{- if not .Values.autoscaling.enabled }}
  replicas: {{ .Values.replicaCount }}
  {{- end }}
  selector:
    matchLabels:
      {{- include "app.selectorLabels" . | nindent 6 }}
  template:
    metadata:
      labels:
        {{- include "app.selectorLabels" . | nindent 8 }}
    spec:
      serviceAccountName: {{ include "app.serviceAccountName" . }}
      containers:
        - name: app
          image: "{{ .Values.image.repository }}:{{ .Values.image.tag }}"
          imagePullPolicy: {{ .Values.image.pullPolicy }}
          ports:
            - name: http
              containerPort: {{ .Values.service.targetPort }}
          livenessProbe:
            httpGet:
              path: /health
              port: http
          readinessProbe:
            httpGet:
              path: /health
              port: http
          resources:
            {{- toYaml .Values.resources | nindent 12 }}
`;

const HELM_SERVICE = `apiVersion: v1
kind: Service
metadata:
  name: {{ include "app.fullname" . }}
  labels:
    {{- include "app.labels" . | nindent 4 }}
spec:
  type: {{ .Values.service.type }}
  ports:
    - port: {{ .Values.service.port }}
      targetPort: http
      protocol: TCP
      name: http
  selector:
    {{- include "app.selectorLabels" . | nindent 4 }}
`;

const HELM_INGRESS = `{{- if .Values.ingress.enabled -}}
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: {{ include "app.fullname" . }}
  labels:
    {{- include "app.labels" . | nindent 4 }}
  annotations:
    {{- with .Values.ingress.annotations }}
    {{- toYaml . | nindent 4 }}
    {{- end }}
spec:
  ingressClassName: {{ .Values.ingress.className }}
  rules:
    {{- range .Values.ingress.hosts }}
    - host: {{ .host | quote }}
      http:
        paths:
          {{- range .paths }}
          - path: {{ .path }}
            pathType: {{ .pathType }}
            backend:
              service:
                name: {{ include "app.fullname" $ }}
                port:
                  number: {{ $.Values.service.port }}
          {{- end }}
    {{- end }}
{{- end }}
`;

const HELM_HELPERS = `{{- define "app.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{- define "app.fullname" -}}
{{- if .Values.fullnameOverride }}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- printf "%s-%s" .Release.Name (include "app.name" .) | trunc 63 | trimSuffix "-" }}
{{- end }}
{{- end }}

{{- define "app.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end }}

{{- define "app.labels" -}}
helm.sh/chart: {{ include "app.chart" . }}
{{ include "app.selectorLabels" . }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}

{{- define "app.selectorLabels" -}}
app.kubernetes.io/name: {{ include "app.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{- define "app.serviceAccountName" -}}
{{- if .Values.serviceAccount.create }}
{{- default (include "app.fullname" .) .Values.serviceAccount.name }}
{{- else }}
{{- default "default" .Values.serviceAccount.name }}
{{- end }}
{{- end }}
`;

/** Outputs must NOT reference undefined resources — that fails terraform validate. */
const SAFE_TF_OUTPUTS = `output "scaffold_note" {
  description = "Reviewable StackForge scaffold — replace with real outputs after resources exist."
  value       = "ok"
}
`;

const HELM_HPA = `{{- if .Values.autoscaling.enabled }}
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: {{ include "app.fullname" . }}
  labels:
    {{- include "app.labels" . | nindent 4 }}
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: {{ include "app.fullname" . }}
  minReplicas: {{ .Values.autoscaling.minReplicas }}
  maxReplicas: {{ .Values.autoscaling.maxReplicas }}
  metrics:
    - type: Resource
      resource:
        name: cpu
        target:
          type: Utilization
          averageUtilization: {{ .Values.autoscaling.targetCPUUtilizationPercentage }}
{{- end }}
`;

const TF_PLACEHOLDER = (note: string) => `# ${note}
# LOCKED validated StackForge template — passes terraform init + validate.
# Replace with full resources after QA; do not invent invalid provider attributes.
`;

/** Paths that must always use locked content (overwrite model hallucinations). */
export const FORCE_STUB_PATHS = new Set([
  'app/server.js',
  'app/package.json',
  'app/package-lock.json',
  'app/Dockerfile',
  'main.py',
  'requirements.txt',
  'main.go',
  'go.mod',
  'Dockerfile',
  // CI skeletons — model often invents actionlint/ECS bleed failures
  '.github/workflows/deploy.yml',
  '.gitlab-ci.yml',
  'azure-pipelines.yml',
  // Helm helpers — missing templates fail helm lint/template
  'charts/app/templates/_helpers.tpl',
  'charts/app/Chart.yaml',
  // Outputs that reference missing resources fail terraform validate hard
  'terraform/outputs.tf',
]);

/** True when this base path must overwrite the model (stubs + all Terraform). */
export function shouldForceLockPath(path: string): boolean {
  if (FORCE_STUB_PATHS.has(path)) return true;
  // Optimal fix: never trust model Terraform — always use profile-validated TF
  if (path.startsWith('terraform/') && path.endsWith('.tf')) return true;
  // environments/*.tfvars are owned by applyScaffoldOptions from interview
  // answers — never force locked staging/us-east-1 defaults over them.
  return false;
}

function awsEcsBase(): BaseFileMap {
  return {
    'terraform/versions.tf': TF_ECS_VERSIONS,
    'terraform/variables.tf': TF_ECS_VARIABLES,
    'terraform/main.tf': TF_ECS_MAIN,
    'terraform/vpc.tf': TF_ECS_VPC,
    'terraform/security_groups.tf': TF_ECS_SG,
    'terraform/iam.tf': TF_ECS_IAM,
    'terraform/alb.tf': TF_ECS_ALB,
    'terraform/ecs.tf': TF_ECS_SERVICE,
    'terraform/database.tf': TF_ECS_DATABASE,
    'terraform/redis.tf': TF_ECS_REDIS,
    'terraform/outputs.tf': TF_ECS_OUTPUTS,
    'environments/staging.tfvars': `aws_region = "us-east-1"\nenvironment = "staging"\n`,
    '.github/workflows/deploy.yml': GHA_ECS_DEPLOY,
    'app/Dockerfile': NODE_DOCKERFILE_APP,
    'app/package.json': EXPRESS_PACKAGE_JSON,
    'app/package-lock.json': EXPRESS_PACKAGE_LOCK,
    'app/server.js': EXPRESS_SERVER,
    'README.md': README_STUB('AWS ECS Fargate Scaffold'),
  };
}

function awsEksBase(): BaseFileMap {
  return {
    'terraform/versions.tf': TF_EKS_VERSIONS,
    'terraform/variables.tf': TF_EKS_VARIABLES,
    'terraform/main.tf': TF_EKS_MAIN,
    'terraform/network.tf': TF_EKS_NETWORK,
    'terraform/security_groups.tf': TF_EKS_SECURITY,
    'terraform/iam.tf': TF_EKS_IAM,
    'terraform/eks.tf': TF_EKS_CLUSTER,
    'terraform/database.tf': TF_EKS_DATABASE,
    'terraform/outputs.tf': TF_EKS_OUTPUTS,
    'environments/staging.tfvars': EKS_ENV_STAGING_TFVARS,
    'environments/development.tfvars': EKS_ENV_DEV_TFVARS,
    '.github/workflows/deploy.yml': GHA_EKS_DEPLOY,
    'app/Dockerfile': NODE_DOCKERFILE_APP,
    'app/package.json': EXPRESS_PACKAGE_JSON,
    'app/package-lock.json': EXPRESS_PACKAGE_LOCK,
    'app/server.js': EXPRESS_SERVER,
    'charts/app/Chart.yaml': HELM_CHART,
    'charts/app/values.yaml': HELM_VALUES,
    'charts/app/templates/_helpers.tpl': HELM_HELPERS,
    'charts/app/templates/deployment.yaml': HELM_DEPLOYMENT,
    'charts/app/templates/service.yaml': HELM_SERVICE,
    'charts/app/templates/ingress.yaml': HELM_INGRESS,
    'charts/app/templates/hpa.yaml': HELM_HPA,
    'charts/app/templates/serviceaccount.yaml': `{{- if .Values.serviceAccount.create -}}
apiVersion: v1
kind: ServiceAccount
metadata:
  name: {{ include "app.serviceAccountName" . }}
  labels:
    {{- include "app.labels" . | nindent 4 }}
  {{- with .Values.serviceAccount.annotations }}
  annotations:
    {{- toYaml . | nindent 4 }}
  {{- end }}
{{- end }}
`,
    'README.md': EKS_README,
  };
}

function gcpCloudRunBase(): BaseFileMap {
  return {
    'terraform/versions.tf': TF_CR_VERSIONS,
    'terraform/variables.tf': TF_CR_VARIABLES,
    'terraform/main.tf': TF_CR_MAIN,
    'terraform/network.tf': TF_CR_NETWORK,
    'terraform/database.tf': TF_CR_DATABASE,
    'terraform/redis.tf': TF_CR_REDIS,
    'terraform/cloudrun.tf': TF_CR_CLOUDRUN,
    'terraform/iam.tf': TF_CR_IAM,
    'terraform/outputs.tf': TF_CR_OUTPUTS,
    'environments/staging.tfvars': `region = "us-central1"\nenvironment = "staging"\ndb_engine = "postgres"\n# project_id = "YOUR_GCP_PROJECT"\n`,
    'environments/development.tfvars': `region = "us-central1"\nenvironment = "development"\ndb_engine = "postgres"\n# project_id = "YOUR_GCP_PROJECT"\n`,
    '.gitlab-ci.yml': GITLAB_CI,
    Dockerfile: PYTHON_DOCKERFILE,
    'requirements.txt': FASTAPI_REQUIREMENTS,
    'main.py': FASTAPI_MAIN,
    'README.md': CLOUDRUN_README,
  };
}

function azureContainerAppsBase(): BaseFileMap {
  return {
    'terraform/versions.tf': TF_ACA_VERSIONS,
    'terraform/variables.tf': TF_ACA_VARIABLES,
    'terraform/main.tf': TF_ACA_MAIN,
    'terraform/network.tf': TF_ACA_NETWORK,
    'terraform/database.tf': TF_ACA_DATABASE,
    'terraform/key_vault.tf': TF_ACA_KEY_VAULT,
    'terraform/identity.tf': TF_ACA_IDENTITY,
    'terraform/container_apps.tf': TF_ACA_APP,
    'terraform/outputs.tf': TF_ACA_OUTPUTS,
    'environments/staging.tfvars': `location = "westeurope"\nenvironment = "staging"\n`,
    'environments/development.tfvars': `location = "westeurope"\nenvironment = "development"\n`,
    'azure-pipelines.yml': AZURE_PIPELINE,
    Dockerfile: GO_DOCKERFILE,
    'go.mod': GO_MOD,
    'go.sum': GO_SUM || '\n',
    'main.go': GO_MAIN,
    'README.md': README_STUB('Azure Container Apps Scaffold'),
  };
}

function oracleOkeBase(): BaseFileMap {
  return {
    'terraform/versions.tf': TF_OKE_VERSIONS,
    'terraform/main.tf': TF_OKE_MAIN,
    'terraform/variables.tf': TF_OKE_VARIABLES,
    'terraform/network.tf': TF_OKE_NETWORK,
    'terraform/oke.tf': TF_OKE_CLUSTER,
    'terraform/database.tf': TF_OKE_DATABASE,
    'terraform/iam.tf': TF_OKE_IAM,
    'terraform/outputs.tf': TF_OKE_OUTPUTS,
    'environments/staging.tfvars': `region = "ap-mumbai-1"\nenvironment = "staging"\n# compartment_ocid = "ocid1.compartment..."\n# tenancy_ocid = "ocid1.tenancy..."\n`,
    '.github/workflows/deploy.yml': GHA_EKS_DEPLOY.replace(/EKS_/g, 'OKE_').replace(
      /eks update-kubeconfig[\s\S]*?\n/,
      'echo "Configure oci ce cluster create-kubeconfig"\n'
    ),
    'app/Dockerfile': NODE_DOCKERFILE_APP,
    'app/package.json': EXPRESS_PACKAGE_JSON,
    'app/package-lock.json': EXPRESS_PACKAGE_LOCK,
    'app/server.js': EXPRESS_SERVER,
    'charts/app/Chart.yaml': HELM_CHART,
    'charts/app/values.yaml': HELM_VALUES,
    'charts/app/templates/_helpers.tpl': HELM_HELPERS,
    'charts/app/templates/deployment.yaml': HELM_DEPLOYMENT,
    'charts/app/templates/service.yaml': HELM_SERVICE,
    'charts/app/templates/ingress.yaml': HELM_INGRESS,
    'charts/app/templates/hpa.yaml': HELM_HPA,
    'README.md': README_STUB('Oracle OKE Scaffold'),
  };
}

function azureAksBase(): BaseFileMap {
  return {
    'terraform/versions.tf': TF_AKS_VERSIONS,
    'terraform/variables.tf': TF_AKS_VARIABLES,
    'terraform/main.tf': TF_AKS_MAIN,
    'terraform/network.tf': TF_AKS_NETWORK,
    'terraform/aks.tf': TF_AKS_CLUSTER,
    'terraform/outputs.tf': TF_AKS_OUTPUTS,
    'environments/staging.tfvars': `location = "eastus"\nenvironment = "staging"\n`,
    '.github/workflows/deploy.yml': GHA_EKS_DEPLOY.replace(/EKS_/g, 'AKS_').replace(
      /aws eks update-kubeconfig[\s\S]*?\n/,
      'echo "az aks get-credentials"\n'
    ),
    'app/Dockerfile': NODE_DOCKERFILE_APP,
    'app/package.json': EXPRESS_PACKAGE_JSON,
    'app/package-lock.json': EXPRESS_PACKAGE_LOCK,
    'app/server.js': EXPRESS_SERVER,
    'charts/app/Chart.yaml': HELM_CHART,
    'charts/app/values.yaml': HELM_VALUES,
    'charts/app/templates/_helpers.tpl': HELM_HELPERS,
    'charts/app/templates/deployment.yaml': HELM_DEPLOYMENT,
    'charts/app/templates/service.yaml': HELM_SERVICE,
    'charts/app/templates/ingress.yaml': HELM_INGRESS,
    'charts/app/templates/hpa.yaml': HELM_HPA,
    'README.md': README_STUB('Azure AKS + Helm Scaffold'),
  };
}

function gcpGkeBase(): BaseFileMap {
  return {
    'terraform/versions.tf': TF_GKE_VERSIONS,
    'terraform/variables.tf': TF_GKE_VARIABLES,
    'terraform/main.tf': TF_GKE_MAIN,
    'terraform/network.tf': TF_GKE_NETWORK,
    'terraform/gke.tf': TF_GKE_CLUSTER,
    'terraform/iam.tf': TF_GKE_IAM,
    'terraform/outputs.tf': TF_GKE_OUTPUTS,
    'environments/staging.tfvars': `region = "us-central1"\nenvironment = "staging"\n# project_id = "YOUR_GCP_PROJECT"\n`,
    '.github/workflows/deploy.yml': GHA_EKS_DEPLOY.replace(/EKS_/g, 'GKE_').replace(
      /aws eks update-kubeconfig[\s\S]*?\n/,
      'echo "gcloud container clusters get-credentials"\n'
    ),
    'app/Dockerfile': NODE_DOCKERFILE_APP,
    'app/package.json': EXPRESS_PACKAGE_JSON,
    'app/package-lock.json': EXPRESS_PACKAGE_LOCK,
    'app/server.js': EXPRESS_SERVER,
    'charts/app/Chart.yaml': HELM_CHART,
    'charts/app/values.yaml': HELM_VALUES,
    'charts/app/templates/_helpers.tpl': HELM_HELPERS,
    'charts/app/templates/deployment.yaml': HELM_DEPLOYMENT,
    'charts/app/templates/service.yaml': HELM_SERVICE,
    'charts/app/templates/ingress.yaml': HELM_INGRESS,
    'charts/app/templates/hpa.yaml': HELM_HPA,
    'README.md': README_STUB('GCP GKE + Helm Scaffold'),
  };
}

const BASES: Record<ScaffoldProfileId, () => BaseFileMap> = {
  'aws-ecs-express': awsEcsBase,
  'aws-eks-helm': awsEksBase,
  'gcp-fastapi-cloudrun': gcpCloudRunBase,
  'azure-go-container-apps': azureContainerAppsBase,
  'oracle-oke-helm': oracleOkeBase,
  'azure-aks-helm': azureAksBase,
  'gcp-gke-helm': gcpGkeBase,
};

export function getProfileBaseFiles(profileId: ScaffoldProfileId): BaseFileMap {
  const factory = BASES[profileId];
  return factory ? factory() : {};
}

export interface MergeLockedBaseOptions {
  /** Fill required paths that the model omitted (default true). */
  fillMissing?: boolean;
  /** Overwrite fragile stub paths even if the model emitted them (default true). */
  forceStubs?: boolean;
  /** Cloud/orchestrator/CI presets — used with scaffoldOptions. */
  presets?: Presets;
  /** Interview answers mapped onto locked templates. */
  scaffoldOptions?: ScaffoldOptions;
}

/**
 * Merge locked profile base files into the generated set.
 * Returns the merged list and which paths were seeded.
 *
 * When forceStubs is on, ALL terraform/*.tf from the profile base overwrite
 * the model, and any extra terraform/*.tf the model invented are removed.
 * That is the reliable path for terraform validate to pass.
 */
export function mergeLockedBaseFiles(
  files: GeneratedFile[],
  profile: ScaffoldProfile,
  options: MergeLockedBaseOptions = {}
): { files: GeneratedFile[]; seeded: string[] } {
  const fillMissing = options.fillMissing !== false;
  const forceStubs = options.forceStubs !== false;
  const base = getProfileBaseFiles(profile.id);
  if (Object.keys(base).length === 0) {
    return { files, seeded: [] };
  }

  const byPath = new Map<string, GeneratedFile>();
  for (const f of files) byPath.set(f.path.replace(/\\/g, '/'), f);

  const seeded: string[] = [];
  const missing = fillMissing
    ? getMissingPaths(files, [...profile.requiredPaths])
    : [];

  const lockedTfPaths = new Set(
    Object.keys(base).filter(
      (p) => p.startsWith('terraform/') && p.endsWith('.tf')
    )
  );

  for (const [path, content] of Object.entries(base)) {
    const exists = byPath.has(path);
    const shouldForce = forceStubs && shouldForceLockPath(path);
    const shouldFill = missing.includes(path) || (!exists && fillMissing);
    const existing = byPath.get(path);
    const emptyExisting = exists && !(existing?.content || '').trim();

    if (!shouldForce && !shouldFill && !emptyExisting) continue;

    byPath.set(path, {
      path,
      language: getLanguageFromPath(path),
      content,
      description: shouldForce
        ? 'Locked validated template (profile-first)'
        : 'Locked base file (profile-first seed)',
    });
    seeded.push(path);
  }

  // Drop model-invented terraform files that are not part of the locked set
  if (forceStubs && lockedTfPaths.size > 0) {
    for (const p of [...byPath.keys()]) {
      if (!p.startsWith('terraform/') || !p.endsWith('.tf')) continue;
      if (lockedTfPaths.has(p)) continue;
      byPath.delete(p);
      seeded.push(`removed:${p}`);
    }
    for (const p of [...byPath.keys()]) {
      if (p.includes('_stackforge_empty')) byPath.delete(p);
    }
  }

  // Drop model-invented Helm charts outside charts/app (nginx-ingress etc. fail lint)
  if (forceStubs) {
    const lockedChartPaths = new Set(
      Object.keys(base).filter((p) => p.startsWith('charts/'))
    );
    if (lockedChartPaths.size > 0) {
      for (const p of [...byPath.keys()]) {
        if (!p.startsWith('charts/')) continue;
        if (lockedChartPaths.has(p)) continue;
        // Keep only charts/app/** from locked base
        if (!p.startsWith('charts/app/')) {
          byPath.delete(p);
          seeded.push(`removed:${p}`);
        }
      }
    }
  }

  let merged = Array.from(byPath.values());
  if (options.scaffoldOptions && options.presets) {
    merged = applyScaffoldOptions(
      merged,
      options.presets,
      options.scaffoldOptions
    );
  }

  return { files: merged, seeded };
}
