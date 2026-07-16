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

# Create a unique temporary directory for this validation run's parallel logs
JOB_DIR=$(mktemp -d /tmp/scaffold-jobs-XXXXXX)

# Job 1: Terraform init + validate
check_tf() {
  if [ -d "$SCAFFOLD_DIR/terraform" ]; then
    cd "$SCAFFOLD_DIR/terraform" || exit 1
    if terraform init -backend=false -input=false > "$JOB_DIR/tf_init.log" 2>&1; then
      if terraform validate -json > "$JOB_DIR/tf_validate.json" 2>"$JOB_DIR/tf_validate.log"; then
        echo "PASS" > "$JOB_DIR/tf_status"
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

# Job 2: Hadolint (Dockerfile)
check_hado() {
  if [ -f "$SCAFFOLD_DIR/Dockerfile" ]; then
    if command -v hadolint > /dev/null 2>&1; then
      if hadolint "$SCAFFOLD_DIR/Dockerfile" > "$JOB_DIR/hado.log" 2>&1; then
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
    PASS) log_pass "terraform validate" ;;
    FAIL_VALIDATE) log_fail "terraform validate -- $(tail -c 1500 "$JOB_DIR/tf_validate.log" "$JOB_DIR/tf_validate.json" 2>/dev/null | tr '\n' ' ')" ;;
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
