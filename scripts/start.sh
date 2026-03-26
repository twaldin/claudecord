#!/bin/bash
# start.sh — Bootstrap the Claudecord agent team
# 1. Starts the router daemon (Discord connection + HTTP API)
# 2. Creates tmux session with LifeOS manager in pane 0
# LifeOS then spawns other agents as needed

set -e

SESSION="claudecord"
REGISTRY="$HOME/claudecord/registry.tsv"
LIFEOS_DIR="$HOME/claudecord/agents/lifeos"
PID_FILE="$HOME/.claudecord-daemon.pid"
ROUTER_PORT="${CLAUDECORD_ROUTER_PORT:-19532}"

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
echo "# name|pane|status|directory|spawned_at" > "$REGISTRY"

# Start router daemon
echo "Starting router daemon on port $ROUTER_PORT..."
cd "$HOME/claudecord"
npx tsx src/daemon/index.ts &
DAEMON_PID=$!
echo "$DAEMON_PID" > "$PID_FILE"
echo "Router daemon started (PID $DAEMON_PID)"
sleep 2

# Verify daemon is alive
if ! kill -0 "$DAEMON_PID" 2>/dev/null; then
  echo "ERROR: Router daemon failed to start. Check logs."
  rm -f "$PID_FILE"
  exit 1
fi

# Create tmux session with LifeOS in pane 0
tmux new-session -d -s "$SESSION" -c "$LIFEOS_DIR" \
  "claude --dangerously-load-development-channels server:claudecord --permission-mode dontAsk"

# Register LifeOS
echo "lifeos|0|alive|$LIFEOS_DIR|$(date -Iseconds)" >> "$REGISTRY"

echo ""
echo "=== Claudecord Started ==="
echo "Router daemon: PID $DAEMON_PID on port $ROUTER_PORT"
echo "LifeOS: tmux pane 0"
echo "Attach: tmux attach -t $SESSION"
echo "Registry: $REGISTRY"
