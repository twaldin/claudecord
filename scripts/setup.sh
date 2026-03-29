#!/usr/bin/env bash
# setup.sh — Fill in {{placeholders}} across all agent CLAUDE.md and .mcp.json files.
#
# Usage: bash scripts/setup.sh [--non-interactive]
#
# Interactive mode (default): prompts for each value.
# Non-interactive: reads from environment variables (useful for CI or scripted setup).
#
# Environment variable equivalents (for --non-interactive):
#   SETUP_USER_NAME, SETUP_CLAUDECORD_HOME, SETUP_CHANNEL_MAIN, SETUP_CHANNEL_ALERTS,
#   SETUP_CHANNEL_DAILY, SETUP_CHANNEL_CODE_STATUS, SETUP_CHANNEL_ARCHITECT,
#   SETUP_CHANNEL_EVALUATOR, SETUP_CHANNEL_RESEARCHER, SETUP_PROJECT_DIR,
#   SETUP_DEPLOY_COMMAND, SETUP_USER_TIMEZONE

set -euo pipefail

CLAUDECORD_HOME_DEFAULT="${CLAUDECORD_HOME:-$HOME/claudecord}"
NON_INTERACTIVE=false

if [[ "${1:-}" == "--non-interactive" ]]; then
  NON_INTERACTIVE=true
fi

# ── Cross-platform sed -i ─────────────────────────────────────────────────────
sed_inplace() {
  if [[ "$OSTYPE" == "darwin"* ]]; then
    sed -i '' "$@"
  else
    sed -i "$@"
  fi
}

# ── Prompt helper ─────────────────────────────────────────────────────────────
prompt() {
  local var_name="$1"
  local prompt_text="$2"
  local default_val="${3:-}"
  local env_var="${4:-}"

  if [[ "$NON_INTERACTIVE" == "true" ]]; then
    if [[ -n "$env_var" && -n "${!env_var:-}" ]]; then
      eval "$var_name=\"${!env_var}\""
      return
    fi
    if [[ -n "$default_val" ]]; then
      eval "$var_name=\"$default_val\""
      return
    fi
    echo "ERROR: $var_name not set and --non-interactive specified" >&2
    exit 1
  fi

  if [[ -n "$default_val" ]]; then
    printf "%s [%s]: " "$prompt_text" "$default_val"
  else
    printf "%s: " "$prompt_text"
  fi

  read -r value
  if [[ -z "$value" && -n "$default_val" ]]; then
    eval "$var_name=\"$default_val\""
  else
    eval "$var_name=\"$value\""
  fi
}

# ── Collect values ────────────────────────────────────────────────────────────
echo ""
echo "Claudecord Setup"
echo "═══════════════════════════════════════════════"
echo "Fill in your values. Press Enter to accept defaults."
echo ""

prompt USER_NAME        "Your name (for agent CLAUDE.md files)"  ""           "SETUP_USER_NAME"
prompt CLAUDECORD_HOME_VAL "Claudecord install directory"        "$CLAUDECORD_HOME_DEFAULT" "SETUP_CLAUDECORD_HOME"
echo ""
echo "Discord channel IDs — find these by enabling Developer Mode in Discord"
echo "  (Settings → Advanced → Developer Mode, then right-click any channel → Copy ID)"
echo ""
prompt CHANNEL_MAIN     "Main channel ID (orchestrator inbox)"   ""           "SETUP_CHANNEL_MAIN"
prompt CHANNEL_ALERTS   "Alerts channel ID"                      "$CHANNEL_MAIN" "SETUP_CHANNEL_ALERTS"
prompt CHANNEL_DAILY    "Daily briefings channel ID"             "$CHANNEL_MAIN" "SETUP_CHANNEL_DAILY"
prompt CHANNEL_CODE     "Code-status channel ID"                 "$CHANNEL_MAIN" "SETUP_CHANNEL_CODE_STATUS"
prompt CHANNEL_ARCH     "Architect channel ID"                   "$CHANNEL_CODE" "SETUP_CHANNEL_ARCHITECT"
prompt CHANNEL_EVAL     "Evaluator channel ID"                   "$CHANNEL_CODE" "SETUP_CHANNEL_EVALUATOR"
prompt CHANNEL_RESEARCH "Researcher channel ID (optional)"       "$CHANNEL_MAIN" "SETUP_CHANNEL_RESEARCHER"
echo ""
prompt PROJECT_DIR      "Project directory (for coder/evaluator/architect)" "$HOME/project" "SETUP_PROJECT_DIR"
prompt DEPLOY_CMD       "Deploy command (optional, leave blank to fill later)" "" "SETUP_DEPLOY_COMMAND"
prompt USER_TZ          "Your timezone (e.g. America/New_York)"  "UTC"        "SETUP_USER_TIMEZONE"

echo ""
echo "Substituting placeholders..."

# ── Build sed substitution list ───────────────────────────────────────────────
# Use | as delimiter to avoid issues with / in paths.
substitutions=(
  "s|{{user_name}}|${USER_NAME}|g"
  "s|{{channel_main}}|${CHANNEL_MAIN}|g"
  "s|{{channel_orchestrator_id}}|${CHANNEL_MAIN}|g"
  "s|{{channel_alerts}}|${CHANNEL_ALERTS}|g"
  "s|{{channel_alerts_id}}|${CHANNEL_ALERTS}|g"
  "s|{{channel_daily}}|${CHANNEL_DAILY}|g"
  "s|{{channel_code_status}}|${CHANNEL_CODE}|g"
  "s|{{channel_code_status_id}}|${CHANNEL_CODE}|g"
  "s|{{channel_architect_id}}|${CHANNEL_ARCH}|g"
  "s|{{channel_evaluator_id}}|${CHANNEL_EVAL}|g"
  "s|{{channel_researcher_id}}|${CHANNEL_RESEARCH}|g"
  "s|{{channel_coder_id}}|${CHANNEL_CODE}|g"
  "s|{{channel_general_id}}|${CHANNEL_MAIN}|g"
  "s|{{project_dir}}|${PROJECT_DIR}|g"
  "s|{{primary_project}}|${PROJECT_DIR}|g"
  "s|{{user_timezone}}|${USER_TZ}|g"
  "s|{{timestamp}}|$(date -Iseconds)|g"
)

# Deploy command: only substitute if non-empty (leave placeholder if not set)
if [[ -n "$DEPLOY_CMD" ]]; then
  substitutions+=("s|{{deploy_command}}|${DEPLOY_CMD}|g")
fi

# ── Find target files ─────────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(dirname "$SCRIPT_DIR")"

# .mcp.json files are written fresh (not sed-patched) to avoid permission prompts in Claude Code.
# Collect only markdown files for sed substitution.
mapfile -t target_files < <(find "$REPO_ROOT/agents" -type f -name "*.md" 2>/dev/null)

if [[ ${#target_files[@]} -eq 0 ]]; then
  echo "WARNING: No agent files found in $REPO_ROOT/agents" >&2
fi

# ── Apply substitutions ───────────────────────────────────────────────────────
for file in "${target_files[@]}"; do
  # Skip files with no placeholders to avoid unnecessary writes
  if ! grep -qF '{{' "$file" 2>/dev/null; then
    continue
  fi

  # Build combined sed expression
  sed_args=()
  for sub in "${substitutions[@]}"; do
    sed_args+=("-e" "$sub")
  done

  sed_inplace "${sed_args[@]}" "$file"
  echo "  ✓ $file"
done

# ── Write .mcp.json files fresh (not sed-patched) ────────────────────────────
# Avoids Claude Code permission prompts triggered by in-place edits to .mcp.json.
write_mcp_json() {
  local agent_name="$1"
  local agent_dir="$REPO_ROOT/agents/$agent_name"
  local mcp_path="$agent_dir/.mcp.json"

  if [[ ! -d "$agent_dir" ]]; then
    return
  fi

  cat > "$mcp_path" << EOF
{
  "mcpServers": {
    "claudecord": {
      "command": "${CLAUDECORD_HOME_VAL}/node_modules/.bin/tsx",
      "args": ["${CLAUDECORD_HOME_VAL}/src/shim/index.ts"],
      "env": {
        "CLAUDECORD_AGENT_NAME": "${agent_name}",
        "CLAUDECORD_DAEMON_URL": "http://localhost:19532",
        "CLAUDECORD_API_SECRET": ""
      }
    }
  }
}
EOF
  echo "  ✓ $mcp_path"
}

for agent in orchestrator architect evaluator researcher reviewer; do
  write_mcp_json "$agent"
done

# ── Verify remaining placeholders ─────────────────────────────────────────────
echo ""
remaining=$(grep -roh '{{[^}]*}}' "$REPO_ROOT/agents" 2>/dev/null | sort -u)
if [[ -n "$remaining" ]]; then
  echo "Remaining placeholders (fill these manually):"
  echo "$remaining" | sed 's/^/  /'
else
  echo "All placeholders filled."
fi

# ── Create config/routing.json from example ──────────────────────────────────
ROUTING_EXAMPLE="$REPO_ROOT/config/routing.example.json"
ROUTING_JSON="$REPO_ROOT/config/routing.json"

if [[ ! -f "$ROUTING_JSON" ]]; then
  cp "$ROUTING_EXAMPLE" "$ROUTING_JSON"

  # Substitute channel IDs into routing.json
  routing_subs=(
    "s|000000000000000001|${CHANNEL_MAIN}|g"
    "s|000000000000000002|${CHANNEL_ALERTS}|g"
    "s|000000000000000003|${CHANNEL_DAILY}|g"
    "s|000000000000000004|${CHANNEL_EVAL}|g"
    "s|000000000000000005|${CHANNEL_RESEARCH}|g"
  )
  routing_args=()
  for sub in "${routing_subs[@]}"; do
    routing_args+=("-e" "$sub")
  done
  sed_inplace "${routing_args[@]}" "$ROUTING_JSON"
  echo "  ✓ $ROUTING_JSON"
else
  echo "  (skipped) $ROUTING_JSON already exists"
fi

echo ""
echo "Setup complete. Next:"
echo "  1. Edit .env — add DISCORD_BOT_TOKEN and ANTHROPIC_API_KEY"
echo "  2. bash scripts/start.sh"
