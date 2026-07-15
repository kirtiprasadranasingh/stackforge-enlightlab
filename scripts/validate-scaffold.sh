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
#
# Requires (install in whatever container/image runs your generation backend):
#   - terraform   (https://developer.hashicorp.com/terraform/install)
#   - helm        (https://helm.sh/docs/intro/install/)
#   - hadolint    (https://github.com/hadolint/hadolint)
#   - actionlint  (https://github.com/rhysd/actionlint)
#   - yamllint    (pip install yamllint)   [optional, non-blocking]

SCAFFOLD_DIR="${1:?Usage: $0 <path-to-scaffold-dir>}"
FAIL=0
REPORT=()

log_pass() { REPORT+=("PASS  - $1"); }
log_fail() { REPORT+=("FAIL  - $1"); FAIL=1; }
log_info() { REPORT+=("INFO  - $1"); }
log_warn() { REPORT+=("WARN  - $1"); }

echo "Validating scaffold at: $SCAFFOLD_DIR"
echo "----------------------------------------"

# 1. Terraform: init (no backend) + validate catches syntax errors, duplicate
#    arguments, undeclared references, and unknown resource/module attributes.
if [ -d "$SCAFFOLD_DIR/terraform" ]; then
  (
    cd "$SCAFFOLD_DIR/terraform" || exit 1
    if terraform init -backend=false -input=false > /tmp/tf_init.log 2>&1; then
      if terraform validate -json > /tmp/tf_validate.json 2>/tmp/tf_validate.log; then
        echo "terraform_ok"
      else
        echo "terraform_validate_fail"
      fi
    else
      echo "terraform_init_fail"
    fi
  ) > /tmp/tf_result.txt
  RESULT=$(cat /tmp/tf_result.txt)
  case "$RESULT" in
    terraform_ok) log_pass "terraform validate" ;;
    terraform_validate_fail) log_fail "terraform validate -- $(tail -c 1500 /tmp/tf_validate.log /tmp/tf_validate.json 2>/dev/null | tr '\n' ' ')" ;;
    terraform_init_fail) log_fail "terraform init -- $(tail -c 1500 /tmp/tf_init.log | tr '\n' ' ')" ;;
  esac
else
  log_info "no terraform/ directory found, skipping"
fi

# 2. Dockerfile: hadolint catches invalid instruction syntax (including the
#    trailing-comment bug), bad base images, and common anti-patterns.
if [ -f "$SCAFFOLD_DIR/Dockerfile" ]; then
  if command -v hadolint > /dev/null 2>&1; then
    if hadolint "$SCAFFOLD_DIR/Dockerfile" > /tmp/hadolint.log 2>&1; then
      log_pass "hadolint (Dockerfile)"
    else
      log_fail "hadolint (Dockerfile) -- $(tail -c 1500 /tmp/hadolint.log | tr '\n' ' ')"
    fi
  else
    log_warn "hadolint not installed, skipping Dockerfile lint"
  fi
else
  log_info "no Dockerfile found, skipping"
fi

# 3. Helm charts: `lint` catches schema issues; `template` actually renders
#    every template, which catches duplicate YAML keys, bad Go-template
#    references, and conditionals that produce invalid output.
if [ -d "$SCAFFOLD_DIR/charts" ]; then
  for chart in "$SCAFFOLD_DIR"/charts/*/; do
    [ -d "$chart" ] || continue
    chart_name=$(basename "$chart")
    if command -v helm > /dev/null 2>&1; then
      if helm lint "$chart" > "/tmp/helm_lint_${chart_name}.log" 2>&1; then
        log_pass "helm lint ($chart_name)"
      else
        log_fail "helm lint ($chart_name) -- $(tail -c 1500 "/tmp/helm_lint_${chart_name}.log" | tr '\n' ' ')"
      fi
      if helm template "$chart_name" "$chart" > "/tmp/helm_template_${chart_name}.log" 2>&1; then
        log_pass "helm template ($chart_name)"
      else
        log_fail "helm template ($chart_name) -- $(tail -c 1500 "/tmp/helm_template_${chart_name}.log" | tr '\n' ' ')"
      fi
    else
      log_warn "helm not installed, skipping chart checks for $chart_name"
    fi
  done
else
  log_info "no charts/ directory found, skipping"
fi

# 4. GitHub Actions workflows: actionlint catches invalid expressions,
#    undefined `github.event.inputs.*` on the wrong trigger, and bad job refs.
if [ -d "$SCAFFOLD_DIR/.github/workflows" ]; then
  if command -v actionlint > /dev/null 2>&1; then
    if actionlint "$SCAFFOLD_DIR"/.github/workflows/*.yml > /tmp/actionlint.log 2>&1; then
      log_pass "actionlint"
    else
      log_fail "actionlint -- $(tail -c 1500 /tmp/actionlint.log | tr '\n' ' ')"
    fi
  else
    log_warn "actionlint not installed, skipping workflow lint"
  fi
else
  log_info "no .github/workflows/ directory found, skipping"
fi

# 5. Generic YAML sanity check (non-blocking) for anything not covered above.
if command -v yamllint > /dev/null 2>&1; then
  while IFS= read -r -d '' f; do
    if ! yamllint -d relaxed "$f" > /tmp/yamllint_last.log 2>&1; then
      log_warn "yamllint issue in $f (non-blocking)"
    fi
  done < <(find "$SCAFFOLD_DIR" -type f \( -name "*.yaml" -o -name "*.yml" \) -print0)
fi

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
