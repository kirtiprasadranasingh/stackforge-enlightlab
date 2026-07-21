#!/usr/bin/env bash
set -uo pipefail

# validate-scaffold.sh
#
# Runs real static validators against a generated StackForge scaffold, so
# mistakes get caught by actual tools instead of relying on the model to
# self-police. Exits 0 only if every blocking check passes.
#
# Usage:
#   ./validate-scaffold.sh /path/to/generated/scaffold

SCAFFOLD_DIR="${1:?Usage: $0 <path-to-scaffold-dir>}"
FAIL=0
REPORT=()

log_pass() { REPORT+=("PASS  - $1"); }
log_fail() { REPORT+=("FAIL  - $1"); FAIL=1; }
log_info() { REPORT+=("INFO  - $1"); }
log_warn() { REPORT+=("WARN  - $1"); }

echo "Validating scaffold at: $SCAFFOLD_DIR"
echo "----------------------------------------"

# Writable per-run plugin cache. A shared path races under concurrent checks
# ("text file busy" / chmod EPERM). Callers may set STACKFORGE_TF_PLUGIN_CACHE.
if [ -z "${STACKFORGE_TF_PLUGIN_CACHE:-}" ]; then
  export TF_PLUGIN_CACHE_DIR="$(mktemp -d /tmp/stackforge-tf-cache-XXXXXX)"
else
  export TF_PLUGIN_CACHE_DIR="$STACKFORGE_TF_PLUGIN_CACHE"
  mkdir -p "$TF_PLUGIN_CACHE_DIR"
fi
# Best-effort seed from the image cache when present (speeds init; never required).
if [ -d /usr/share/terraform/plugin-cache ] && [ -z "$(ls -A "$TF_PLUGIN_CACHE_DIR" 2>/dev/null)" ]; then
  cp -a /usr/share/terraform/plugin-cache/. "$TF_PLUGIN_CACHE_DIR/" 2>/dev/null || true
fi

# Create a unique temporary directory for this validation run's parallel logs
JOB_DIR=$(mktemp -d /tmp/scaffold-jobs-XXXXXX)

# Job 1: Terraform init + validate + plan (plan is non-blocking when creds/vars missing)
check_tf() {
  if [ -d "$SCAFFOLD_DIR/terraform" ]; then
    cd "$SCAFFOLD_DIR/terraform" || exit 1
    set +e
    terraform init -backend=false -input=false > "$JOB_DIR/tf_init.log" 2>&1
    INIT_EXIT=$?
    # One retry with a fresh cache on plugin install races
    if [ "$INIT_EXIT" -ne 0 ] && grep -qiE 'text file busy|operation not permitted' "$JOB_DIR/tf_init.log" 2>/dev/null; then
      export TF_PLUGIN_CACHE_DIR="$(mktemp -d /tmp/stackforge-tf-cache-XXXXXX)"
      terraform init -backend=false -input=false > "$JOB_DIR/tf_init.log" 2>&1
      INIT_EXIT=$?
    fi
    set -e
    if [ "$INIT_EXIT" -eq 0 ]; then
      if terraform validate -json > "$JOB_DIR/tf_validate.json" 2>"$JOB_DIR/tf_validate.log"; then
        set +e
        terraform plan -input=false -refresh=false -lock=false -no-color > "$JOB_DIR/tf_plan.log" 2>&1
        PLAN_EXIT=$?
        set -e
        if [ "$PLAN_EXIT" -eq 0 ] || [ "$PLAN_EXIT" -eq 2 ]; then
          echo "PASS" > "$JOB_DIR/tf_status"
        elif grep -qiE 'credential|auth|access denied|unauthorized|no valid credential|could not load credentials|account.*not found|invalid provider configuration|missing required argument|required variable' "$JOB_DIR/tf_plan.log" 2>/dev/null; then
          echo "PASS_VALIDATE_ONLY" > "$JOB_DIR/tf_status"
        else
          echo "WARN_PLAN" > "$JOB_DIR/tf_status"
        fi
      else
        echo "FAIL_VALIDATE" > "$JOB_DIR/tf_status"
      fi
    else
      echo "FAIL_INIT" > "$JOB_DIR/tf_status"
    fi
  else
    echo "SKIP" > "$JOB_DIR/tf_status"
  fi
}
check_tf &
PID_TF=$!

# Job 2: Hadolint (Dockerfile at root or app/)
check_hado() {
  local df=""
  if [ -f "$SCAFFOLD_DIR/Dockerfile" ]; then
    df="$SCAFFOLD_DIR/Dockerfile"
  elif [ -f "$SCAFFOLD_DIR/app/Dockerfile" ]; then
    df="$SCAFFOLD_DIR/app/Dockerfile"
  fi
  if [ -n "$df" ]; then
    if command -v hadolint > /dev/null 2>&1; then
      if hadolint "$df" > "$JOB_DIR/hado.log" 2>&1; then
        echo "PASS" > "$JOB_DIR/hado_status"
      else
        echo "FAIL" > "$JOB_DIR/hado_status"
      fi
    else
      echo "WARN" > "$JOB_DIR/hado_status"
    fi
  else
    echo "SKIP" > "$JOB_DIR/hado_status"
  fi
}
check_hado &
PID_HADO=$!

# Job 3: Helm (lint + template)
check_helm() {
  if [ -d "$SCAFFOLD_DIR/charts" ]; then
    local chart_fail=0
    local chart_found=0
    for chart in "$SCAFFOLD_DIR"/charts/*/; do
      [ -d "$chart" ] || continue
      chart_found=1
      local chart_name
      chart_name=$(basename "$chart")
      if command -v helm > /dev/null 2>&1; then
        if ! helm lint "$chart" > "$JOB_DIR/helm_lint_${chart_name}.log" 2>&1; then
          chart_fail=1
        fi
        if ! helm template "$chart_name" "$chart" > "$JOB_DIR/helm_template_${chart_name}.log" 2>&1; then
          chart_fail=1
        fi
      else
        chart_fail=2 # Helm missing
      fi
    done
    if [ "$chart_found" -eq 0 ]; then
      echo "SKIP" > "$JOB_DIR/helm_status"
    elif [ "$chart_fail" -eq 1 ]; then
      echo "FAIL" > "$JOB_DIR/helm_status"
    elif [ "$chart_fail" -eq 2 ]; then
      echo "WARN" > "$JOB_DIR/helm_status"
    else
      echo "PASS" > "$JOB_DIR/helm_status"
    fi
  else
    echo "SKIP" > "$JOB_DIR/helm_status"
  fi
}
check_helm &
PID_HELM=$!

# Job 4: Actionlint (workflows)
check_action() {
  if [ -d "$SCAFFOLD_DIR/.github/workflows" ]; then
    if command -v actionlint > /dev/null 2>&1; then
      # Make sure we don't glob fail if directory is empty
      local files
      files=$(find "$SCAFFOLD_DIR/.github/workflows" -name "*.yml" -o -name "*.yaml")
      if [ -n "$files" ]; then
        if actionlint $files > "$JOB_DIR/action.log" 2>&1; then
          echo "PASS" > "$JOB_DIR/action_status"
        else
          echo "FAIL" > "$JOB_DIR/action_status"
        fi
      else
        echo "SKIP" > "$JOB_DIR/action_status"
      fi
    else
      echo "WARN" > "$JOB_DIR/action_status"
    fi
  else
    echo "SKIP" > "$JOB_DIR/action_status"
  fi
}
check_action &
PID_ACTION=$!

# Wait for all background verification tasks to complete
wait $PID_TF $PID_HADO $PID_HELM $PID_ACTION

# 1. Process Terraform Result
if [ -f "$JOB_DIR/tf_status" ]; then
  TF_RES=$(cat "$JOB_DIR/tf_status")
  case "$TF_RES" in
    PASS) log_pass "terraform init"; log_pass "terraform validate"; log_pass "terraform plan" ;;
    PASS_VALIDATE_ONLY) log_pass "terraform init"; log_pass "terraform validate"; log_warn "terraform plan skipped — cloud credentials or required variables not available (expected in generator QA)" ;;
    WARN_PLAN) log_pass "terraform init"; log_pass "terraform validate"; log_warn "terraform plan -- $(tail -c 1200 "$JOB_DIR/tf_plan.log" 2>/dev/null | tr '\n' ' ')" ;;
    FAIL_VALIDATE)
      log_pass "terraform init"
      VAL_MSG=$(grep -oE '"summary": "[^"]+"|"detail": "[^"]+"' "$JOB_DIR/tf_validate.json" 2>/dev/null | tr '\n' ' ' | tr -d '\r')
      if [ -z "$VAL_MSG" ]; then
        VAL_MSG=$(tail -c 1200 "$JOB_DIR/tf_validate.log" 2>/dev/null | tr '\n' ' ')
      fi
      log_fail "terraform validate -- ${VAL_MSG:0:1500}"
      ;;
    FAIL_INIT) log_fail "terraform init -- $(tail -c 1500 "$JOB_DIR/tf_init.log" | tr '\n' ' ')" ;;
    SKIP) log_info "no terraform/ directory found, skipping" ;;
  esac
fi

# 2. Process Hadolint Result
if [ -f "$JOB_DIR/hado_status" ]; then
  HADO_RES=$(cat "$JOB_DIR/hado_status")
  case "$HADO_RES" in
    PASS) log_pass "hadolint (Dockerfile)" ;;
    FAIL) log_fail "hadolint (Dockerfile) -- $(tail -c 1500 "$JOB_DIR/hado.log" | tr '\n' ' ')" ;;
    WARN) log_warn "hadolint not installed, skipping Dockerfile lint" ;;
    SKIP) log_info "no Dockerfile found, skipping" ;;
  esac
fi

# 3. Process Helm Result
if [ -f "$JOB_DIR/helm_status" ]; then
  HELM_RES=$(cat "$JOB_DIR/helm_status")
  case "$HELM_RES" in
    PASS) log_pass "helm checks passed" ;;
    FAIL)
      for f in "$JOB_DIR"/helm_lint_*.log; do
        [ -f "$f" ] || continue
        chart_name=$(basename "$f" | sed -e 's/helm_lint_//' -e 's/\.log//')
        log_fail "helm lint ($chart_name) -- $(tail -c 1500 "$f" | tr '\n' ' ')"
      done
      for f in "$JOB_DIR"/helm_template_*.log; do
        [ -f "$f" ] || continue
        chart_name=$(basename "$f" | sed -e 's/helm_template_//' -e 's/\.log//')
        log_fail "helm template ($chart_name) -- $(tail -c 1500 "$f" | tr '\n' ' ')"
      done
      ;;
    WARN) log_warn "helm not installed, skipping chart checks" ;;
    SKIP) log_info "no charts/ directory found, skipping" ;;
  esac
fi

# 4. Process Actionlint Result
if [ -f "$JOB_DIR/action_status" ]; then
  ACTION_RES=$(cat "$JOB_DIR/action_status")
  case "$ACTION_RES" in
    PASS) log_pass "actionlint" ;;
    FAIL) log_fail "actionlint -- $(tail -c 1500 "$JOB_DIR/action.log" | tr '\n' ' ')" ;;
    WARN) log_warn "actionlint not installed, skipping workflow lint" ;;
    SKIP) log_info "no .github/workflows/ directory found, skipping" ;;
  esac
fi

# 5. Generic YAML sanity check (non-blocking)
if command -v yamllint > /dev/null 2>&1; then
  while IFS= read -r -d '' f; do
    if ! yamllint -d relaxed "$f" > /tmp/yamllint_last.log 2>&1; then
      log_warn "yamllint issue in $f (non-blocking)"
    fi
  done < <(find "$SCAFFOLD_DIR" -type f \( -name "*.yaml" -o -name "*.yml" \) -print0)
fi

# 6. EKS IRSA: app deploy check
if [ -f "$SCAFFOLD_DIR/.github/workflows/deploy.yml" ]; then
  if grep -qE 'alb_controller_iam_role_arn|aws-load-balancer-controller' "$SCAFFOLD_DIR/.github/workflows/deploy.yml" \
     && grep -qE 'serviceAccount\.annotations.*role-arn' "$SCAFFOLD_DIR/.github/workflows/deploy.yml"; then
    log_fail "deploy.yml wires ALB controller IAM role to app serviceAccount — use Terraform helm_release in kube-system instead"
  else
    log_pass "deploy.yml does not attach ALB controller role to app serviceAccount"
  fi
fi

# 7. EKS ALB Controller setup check
if [ -d "$SCAFFOLD_DIR/terraform" ]; then
  if grep -rq 'aws-load-balancer-controller\|alb\.ingress\.kubernetes\.io' "$SCAFFOLD_DIR" 2>/dev/null; then
    if grep -rq 'helm_release' "$SCAFFOLD_DIR/terraform" 2>/dev/null \
       && grep -rq 'aws-load-balancer-controller' "$SCAFFOLD_DIR/terraform" 2>/dev/null; then
      log_pass "terraform installs aws-load-balancer-controller via helm_release"
    else
      log_fail "EKS ingress references ALB controller but terraform/ has no helm_release for aws-load-balancer-controller"
    fi
  fi
fi

# 8. Helm HPA existence check
if [ -f "$SCAFFOLD_DIR/charts/app/values.yaml" ]; then
  if grep -qE 'autoscaling:[\s\S]*enabled:\s*true' "$SCAFFOLD_DIR/charts/app/values.yaml" 2>/dev/null \
     || grep -A3 'autoscaling:' "$SCAFFOLD_DIR/charts/app/values.yaml" 2>/dev/null | grep -q 'enabled: true'; then
    if [ -f "$SCAFFOLD_DIR/charts/app/templates/hpa.yaml" ]; then
      log_pass "charts/app/templates/hpa.yaml present with autoscaling enabled"
    else
      log_fail "autoscaling.enabled is true but charts/app/templates/hpa.yaml is missing"
    fi
  fi
fi

# 9. Go: Dockerfile references go.mod but files missing
if [ -f "$SCAFFOLD_DIR/Dockerfile" ]; then
  if grep -qE 'COPY\s+go\.mod' "$SCAFFOLD_DIR/Dockerfile" 2>/dev/null; then
    if [ -f "$SCAFFOLD_DIR/go.mod" ]; then
      log_pass "go.mod present (Dockerfile expects it)"
    else
      log_fail "Dockerfile COPY go.mod but go.mod is missing from output"
    fi
    if grep -qE 'COPY\s+go\.mod\s+go\.sum' "$SCAFFOLD_DIR/Dockerfile" 2>/dev/null; then
      if [ -f "$SCAFFOLD_DIR/go.sum" ]; then
        log_pass "go.sum present (Dockerfile expects it)"
      else
        log_fail "Dockerfile COPY go.sum but go.sum is missing from output"
      fi
    fi
  fi
fi

# 10. Azure Container Apps: Key Vault secret wiring
if [ -d "$SCAFFOLD_DIR/terraform" ]; then
  if grep -rq 'azurerm_container_app' "$SCAFFOLD_DIR/terraform" 2>/dev/null; then
    if grep -rqE 'value\s*=\s*azurerm_key_vault_secret\.[a-zA-Z0-9_]+\.id' "$SCAFFOLD_DIR/terraform" 2>/dev/null; then
      log_fail "container app secret uses value = key_vault_secret.id — use key_vault_secret_id + identity instead"
    else
      log_pass "container app does not set secret value to Key Vault secret resource id"
    fi
    if grep -rq 'azurerm_role_assignment' "$SCAFFOLD_DIR/terraform" 2>/dev/null \
       && grep -rq 'Key Vault Secrets User' "$SCAFFOLD_DIR/terraform" 2>/dev/null; then
      if grep -rq 'enable_rbac_authorization\s*=\s*true' "$SCAFFOLD_DIR/terraform" 2>/dev/null; then
        log_pass "Key Vault RBAC enabled for role assignments"
      else
        log_fail "azurerm_role_assignment for Key Vault but enable_rbac_authorization not set on azurerm_key_vault"
      fi
    fi
    if grep -rqE 'delegations\s*\{' "$SCAFFOLD_DIR/terraform" 2>/dev/null; then
      log_fail "azurerm_subnet uses invalid delegations block — use delegation { service_delegation { ... } }"
    fi
    if grep -rq 'azurerm_container_app' "$SCAFFOLD_DIR/terraform" 2>/dev/null \
       && ! grep -rq 'ignore_changes' "$SCAFFOLD_DIR/terraform" 2>/dev/null; then
      if grep -rqE 'image\s*=\s*".*:latest"' "$SCAFFOLD_DIR/terraform" 2>/dev/null \
         && [ -f "$SCAFFOLD_DIR/azure-pipelines.yml" ]; then
        log_fail "container app hardcodes :latest image without lifecycle ignore_changes while azure-pipelines deploys images"
      fi
    fi
  fi
fi

# 11. Azure DevOps: ACR CLI name vs repository path
if [ -f "$SCAFFOLD_DIR/azure-pipelines.yml" ]; then
  if grep -qE 'az acr show --name.*acrRepository' "$SCAFFOLD_DIR/azure-pipelines.yml" 2>/dev/null; then
    log_fail "azure-pipelines.yml passes acrRepository to az acr show --name (need registry name, not repo path)"
  fi
  if grep -qE 'on:\s*$|failure:' "$SCAFFOLD_DIR/azure-pipelines.yml" 2>/dev/null \
     && grep -qiE 'rollback|deployment failed' "$SCAFFOLD_DIR/azure-pipelines.yml" 2>/dev/null \
     && grep -qE '^\s*-\s*script:\s*echo' "$SCAFFOLD_DIR/azure-pipelines.yml" 2>/dev/null \
     && ! grep -qE 'containerapp revision activate' "$SCAFFOLD_DIR/azure-pipelines.yml" 2>/dev/null; then
    log_fail "azure-pipelines.yml rollback is echo-only — wire az containerapp revision activate"
  fi
fi

# 12. Azure Go Container Apps — PRD file completeness
if [ -f "$SCAFFOLD_DIR/azure-pipelines.yml" ] && [ -f "$SCAFFOLD_DIR/terraform/container_apps.tf" ]; then
  missing=""
  for f in \
    terraform/versions.tf terraform/variables.tf terraform/main.tf terraform/network.tf \
    terraform/database.tf terraform/key_vault.tf terraform/identity.tf terraform/container_apps.tf \
    terraform/outputs.tf azure-pipelines.yml Dockerfile go.mod go.sum main.go README.md; do
    if [ ! -f "$SCAFFOLD_DIR/$f" ]; then
      # allow keyvault.tf alias
      if [ "$f" = "terraform/key_vault.tf" ] && [ -f "$SCAFFOLD_DIR/terraform/keyvault.tf" ]; then
        continue
      fi
      missing="$missing $f"
    fi
  done
  if [ -n "$missing" ]; then
    log_fail "Azure Go Container Apps scaffold missing required files:$missing"
  else
    log_pass "Azure Go Container Apps PRD file set complete (15 files)"
  fi
fi

# 13. AWS ECS: provider pin + healthCheck vs Dockerfile + CI image_uri
if [ -d "$SCAFFOLD_DIR/terraform" ] && grep -rq 'aws_ecs_service\|aws_ecs_task_definition' "$SCAFFOLD_DIR/terraform" 2>/dev/null; then
  if grep -rq 'required_providers' "$SCAFFOLD_DIR/terraform" 2>/dev/null \
     && grep -rqE 'hashicorp/aws|"aws"' "$SCAFFOLD_DIR/terraform" 2>/dev/null; then
    log_pass "ECS terraform declares required_providers for aws"
  else
    log_fail "ECS terraform missing required_providers { aws = ... } pin"
  fi

  if grep -rqE 'curl\s+-f|CMD-SHELL.*curl' "$SCAFFOLD_DIR/terraform" 2>/dev/null; then
    HADO_DF=""
    if [ -f "$SCAFFOLD_DIR/Dockerfile" ]; then
      HADO_DF="$SCAFFOLD_DIR/Dockerfile"
    elif [ -f "$SCAFFOLD_DIR/app/Dockerfile" ]; then
      HADO_DF="$SCAFFOLD_DIR/app/Dockerfile"
    fi
    if [ -n "$HADO_DF" ] \
       && grep -qiE 'apk add.*curl|apt-get install.*curl|yum install.*curl|microdnf install.*curl' "$HADO_DF" 2>/dev/null; then
      log_pass "ECS curl healthCheck has matching curl install in Dockerfile"
    else
      log_fail "ECS task healthCheck uses curl but Dockerfile does not install curl"
    fi
  fi

  if grep -rq 'aws_ecs_service' "$SCAFFOLD_DIR/terraform" 2>/dev/null \
     && [ -f "$SCAFFOLD_DIR/.github/workflows/deploy.yml" ]; then
    if grep -rq 'ignore_changes' "$SCAFFOLD_DIR/terraform" 2>/dev/null; then
      log_pass "ECS service has lifecycle ignore_changes for CI-owned task definition"
    else
      log_fail "ECS + GitHub Actions deploy present but terraform has no lifecycle ignore_changes on service/task image ownership"
    fi
  fi
fi

# 14. GitHub Actions: image_uri must be produced by a real step
if [ -f "$SCAFFOLD_DIR/.github/workflows/deploy.yml" ]; then
  WF="$SCAFFOLD_DIR/.github/workflows/deploy.yml"
  # Common bug: docker/build-push-action does not emit outputs.image_uri
  if grep -qE 'steps\.build-and-push\.outputs\.image_uri|steps\.build_and_push\.outputs\.image_uri' "$WF" 2>/dev/null; then
    log_fail "deploy.yml reads image_uri from build-and-push step — docker/build-push-action does not set that; write registry/repo:tag via a dedicated step id"
  elif grep -qE 'needs\.[a-zA-Z0-9_-]+\.outputs\.image_uri|outputs\.image_uri' "$WF" 2>/dev/null; then
    if grep -qE 'echo ["'\'']?image_uri=' "$WF" 2>/dev/null || grep -qE 'image_uri=\$\{' "$WF" 2>/dev/null; then
      log_pass "deploy.yml writes image_uri to GITHUB_OUTPUT"
    else
      log_fail "deploy.yml references image_uri output but never writes image_uri= to GITHUB_OUTPUT"
    fi
  fi
  if grep -qE 'amazon-ecr-login|ecr-login|ECR_REPOSITORY|aws ecs update-service' "$WF" 2>/dev/null; then
    if grep -qE 'services-stable|service-stable|deployments-stable' "$WF" 2>/dev/null; then
      log_pass "ECS deploy waits for services-stable (or equivalent)"
    else
      log_fail "ECS deploy.yml updates service but does not wait for services-stable before success"
    fi
  fi
fi

# 15. Node/Express: package-lock when Dockerfile copies package*.json
if [ -f "$SCAFFOLD_DIR/Dockerfile" ] && grep -qE 'package\*\.json|package\.json' "$SCAFFOLD_DIR/Dockerfile" 2>/dev/null; then
  if [ -f "$SCAFFOLD_DIR/app/package.json" ] || [ -f "$SCAFFOLD_DIR/package.json" ]; then
    if [ -f "$SCAFFOLD_DIR/app/package-lock.json" ] || [ -f "$SCAFFOLD_DIR/package-lock.json" ]; then
      log_pass "package-lock.json present for Node app"
    else
      log_fail "Node Dockerfile/package.json present but package-lock.json is missing"
    fi
  fi
fi

# 16. App /health must exist when ALB/target group or probes use /health
if grep -rqE 'path\s*=\s*"/health"|path:\s*/health|/health' "$SCAFFOLD_DIR" 2>/dev/null; then
  if grep -rqE "['\"]\/health['\"]|/health" "$SCAFFOLD_DIR" --include='*.js' --include='*.ts' --include='*.py' --include='*.go' 2>/dev/null \
     || grep -rqE 'get\("/health"|Get\("/health"|@app\.(get|route)\("/health"' "$SCAFFOLD_DIR" 2>/dev/null; then
    log_pass "application defines /health matching infra health checks"
  else
    # only fail when we clearly have an app source tree
    if ls "$SCAFFOLD_DIR"/*.py "$SCAFFOLD_DIR"/*.go "$SCAFFOLD_DIR"/app/*.js "$SCAFFOLD_DIR"/app/*.ts 2>/dev/null | grep -q .; then
      log_fail "infra references /health but app source has no /health route"
    fi
  fi
fi

# 17. GCP Cloud Run / Cloud SQL schema + networking
if [ -d "$SCAFFOLD_DIR/terraform" ] && grep -rq 'google_sql_database_instance\|google_cloud_run' "$SCAFFOLD_DIR/terraform" 2>/dev/null; then
  if grep -rq 'deletion_protection_enabled' "$SCAFFOLD_DIR/terraform" 2>/dev/null; then
    log_fail "terraform uses deletion_protection_enabled — use deletion_protection for Cloud SQL"
  fi
  if grep -rqE 'ip_configuration[\s\S]*ipv4_enabled\s*=\s*false|private_network' "$SCAFFOLD_DIR/terraform" 2>/dev/null; then
    if grep -rq 'google_service_networking_connection' "$SCAFFOLD_DIR/terraform" 2>/dev/null \
       && grep -rq 'google_compute_global_address' "$SCAFFOLD_DIR/terraform" 2>/dev/null; then
      log_pass "private Cloud SQL has service networking + reserved range"
    else
      log_fail "private Cloud SQL configured without google_service_networking_connection + global address"
    fi
  fi
  if grep -rq 'repository_url' "$SCAFFOLD_DIR/terraform" 2>/dev/null \
     && grep -rq 'google_artifact_registry_repository' "$SCAFFOLD_DIR/terraform" 2>/dev/null; then
    log_fail "terraform references repository_url on Artifact Registry — construct the URL from location/project/repository_id"
  fi
fi

# 18. GitLab CI: fake quality gates
if [ -f "$SCAFFOLD_DIR/.gitlab-ci.yml" ]; then
  if grep -qiE 'echo.*(test|lint).*pass|tests? passed' "$SCAFFOLD_DIR/.gitlab-ci.yml" 2>/dev/null \
     && grep -qE 'allow_failure:\s*true' "$SCAFFOLD_DIR/.gitlab-ci.yml" 2>/dev/null; then
    log_fail "GitLab CI uses simulated tests and/or allow_failure on quality gate"
  fi
fi

# 19. AWS ECS Express — PRD file completeness
if [ -f "$SCAFFOLD_DIR/.github/workflows/deploy.yml" ] \
   && grep -rq 'aws_ecs_service' "$SCAFFOLD_DIR/terraform" 2>/dev/null \
   && { [ -f "$SCAFFOLD_DIR/app/package.json" ] || [ -f "$SCAFFOLD_DIR/package.json" ]; }; then
  missing=""
  for f in \
    terraform/versions.tf terraform/variables.tf terraform/outputs.tf \
    .github/workflows/deploy.yml README.md; do
    if [ ! -f "$SCAFFOLD_DIR/$f" ]; then
      missing="$missing $f"
    fi
  done
  if [ ! -f "$SCAFFOLD_DIR/Dockerfile" ] && [ ! -f "$SCAFFOLD_DIR/app/Dockerfile" ]; then
    missing="$missing Dockerfile"
  fi
  if [ ! -f "$SCAFFOLD_DIR/terraform/main.tf" ] \
     && [ ! -f "$SCAFFOLD_DIR/terraform/ecs.tf" ]; then
    missing="$missing terraform/main.tf"
  fi
  if [ ! -f "$SCAFFOLD_DIR/app/package.json" ] && [ ! -f "$SCAFFOLD_DIR/package.json" ]; then
    missing="$missing app/package.json"
  fi
  if [ -n "$missing" ]; then
    log_fail "AWS ECS Express scaffold missing required files:$missing"
  else
    log_pass "AWS ECS Express core file set present"
  fi
fi

# 20. App stub scope — reject full business-app patterns in generated sources
APP_SRC_HITS=$(
  grep -RIlE \
    'create_all\(|Base\.metadata\.create_all|@app\.(post|put|delete|patch)\(|router\.(post|put|delete)|/items|passport|jwt\.sign|SQLAlchemy|declarative_base' \
    "$SCAFFOLD_DIR" \
    --include='*.py' --include='*.js' --include='*.ts' --include='*.go' 2>/dev/null || true
)
STUB_SCOPE_OK=1
if [ -n "$APP_SRC_HITS" ]; then
  STUB_SCOPE_OK=0
  log_fail "app sources look like a full business app (CRUD/ORM/auth). Keep a minimal /health stub only. Offending files: $(echo "$APP_SRC_HITS" | tr '\n' ' ')"
fi
for candidate in \
  "$SCAFFOLD_DIR/main.py" \
  "$SCAFFOLD_DIR/main.go" \
  "$SCAFFOLD_DIR/app/index.js" \
  "$SCAFFOLD_DIR/app/main.js"; do
  if [ -f "$candidate" ]; then
    lines=$(wc -l < "$candidate" | tr -d ' ')
    if [ "$lines" -gt 120 ]; then
      STUB_SCOPE_OK=0
      log_fail "app stub $candidate is ${lines} lines (>120) — likely more than a health-check stub"
    fi
  fi
done
if [ "$STUB_SCOPE_OK" -eq 1 ]; then
  log_pass "app sources stay within minimal stub patterns"
fi

# Clean up parallel log outputs
rm -rf "$JOB_DIR"

echo
echo "===== VALIDATION REPORT ====="
printf '%s\n' "${REPORT[@]}"
echo "=============================="

if [ "$FAIL" -eq 1 ]; then
  echo "RESULT: FAILED — one or more blocking checks failed."
else
  echo "RESULT: PASSED — all blocking checks succeeded."
fi

exit $FAIL
