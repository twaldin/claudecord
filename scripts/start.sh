#!/bin/bash
# start.sh — Bootstrap the Claudecord agent team
# 1. Starts the daemon (Discord connection + HTTP API)
# 2. Creates tmux session with orchestrator in pane 0
# Orchestrator then spawns other agents as needed

set -e

SESSION="${CLAUDECORD_SESSION:-claudecord}"
CLAUDECORD_HOME="${CLAUDECORD_HOME:-$HOME/claudecord}"
REGISTRY="$CLAUDECORD_HOME/registry.tsv"
ORCHESTRATOR_DIR="$CLAUDECORD_HOME/agents/orchestrator"
PID_FILE="$HOME/.claudecord-daemon.pid"
DAEMON_PORT="${CLAUDECORD_PORT:-19532}"

# Kill existing daemon if running
if [ -f "$PID_FILE" ]; then
  OLD_PID=$(cat "$PID_FILE")
  if kill -0 "$OLD_PID" 2>/dev/null; then
    echo "Killing existing daemon (PID $OLD_PID)..."
    kill "$OLD_PID" 2>/dev/null || true
    sleep 1
  fi
  rm -f "$PID_FILE"
fi

# Kill existing tmux session if any
if tmux has-session -t "$SESSION" 2>/dev/null; then
  echo "Killing existing tmux session..."
  tmux kill-session -t "$SESSION"
fi

# Clear registry
mkdir -p "$CLAUDECORD_HOME"
echo "# name|window|pane|status|directory|spawned_at" > "$REGISTRY"

# Start daemon
echo "Starting daemon on port $DAEMON_PORT..."
cd "$CLAUDECORD_HOME"
npx tsx src/daemon/index.ts &
DAEMON_PID=$!
echo "$DAEMON_PID" > "$PID_FILE"
echo "Daemon started (PID $DAEMON_PID)"

# Wait up to 10s for daemon to be ready
for i in $(seq 1 10); do
  if kill -0 "$DAEMON_PID" 2>/dev/null; then
    if curl -sf "http://localhost:$DAEMON_PORT/health" >/dev/null 2>&1 || [ $i -ge 5 ]; then
      break
    fi
  fi
  sleep 1
done

# Verify daemon is alive
if ! kill -0 "$DAEMON_PID" 2>/dev/null; then
  echo "ERROR: Daemon failed to start. Check logs."
  rm -f "$PID_FILE"
  exit 1
fi

# Create tmux session with orchestrator in pane 0
tmux new-session -d -s "$SESSION" -c "$ORCHESTRATOR_DIR" \
  "export PATH=\"$CLAUDECORD_HOME/scripts/agents:$CLAUDECORD_HOME/scripts/tools:\$PATH\"; claude --dangerously-load-development-channels server:claudecord --permission-mode dontAsk"

# Register orchestrator
echo "orchestrator|0|0|alive|$ORCHESTRATOR_DIR|$(date -Iseconds)" >> "$REGISTRY"

echo ""
echo "=== Claudecord Started ==="
echo "Daemon: PID $DAEMON_PID on port $DAEMON_PORT"
echo "Orchestrator: tmux pane 0"
echo "Attach: tmux attach -t $SESSION"
echo "Registry: $REGISTRY"
