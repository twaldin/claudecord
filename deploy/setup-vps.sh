#!/bin/bash
# setup-vps.sh — One-shot Claudecord VPS setup (Ubuntu/Debian)
#
# Run as root on a fresh VPS:
#   curl -fsSL https://raw.githubusercontent.com/twaldin/claudecord/main/deploy/setup-vps.sh | bash
#
# Or clone and run:
#   git clone https://github.com/twaldin/claudecord
#   cd claudecord && sudo bash deploy/setup-vps.sh

set -e

# ── Config ────────────────────────────────────────────────────────────────────
APP_USER="${APP_USER:-claudecord}"
APP_DIR="/home/$APP_USER/claudecord"
NODE_VERSION="22"
# ──────────────────────────────────────────────────────────────────────────────

echo "=== Claudecord VPS Setup ==="
echo "User: $APP_USER"
echo "App dir: $APP_DIR"
echo ""

# 1. System packages
echo "[1/7] Installing system packages..."
apt-get update -q
apt-get install -y -q curl git tmux build-essential

# 2. Node.js via NodeSource
echo "[2/7] Installing Node.js $NODE_VERSION..."
if ! command -v node >/dev/null 2>&1; then
  curl -fsSL "https://deb.nodesource.com/setup_${NODE_VERSION}.x" | bash -
  apt-get install -y -q nodejs
fi
echo "Node: $(node --version), npm: $(npm --version)"

# 3. Install Claude Code CLI
echo "[3/7] Installing Claude Code..."
if ! command -v claude >/dev/null 2>&1; then
  npm install -g @anthropic-ai/claude-code
fi
echo "Claude: $(claude --version 2>/dev/null || echo 'installed')"

# 4. Create app user
echo "[4/7] Creating user $APP_USER..."
if ! id "$APP_USER" &>/dev/null; then
  useradd -m -s /bin/bash "$APP_USER"
  echo "Created user $APP_USER"
else
  echo "User $APP_USER already exists"
fi

# 5. Clone or update repo
echo "[5/7] Setting up app directory..."
if [ -d "$APP_DIR/.git" ]; then
  echo "Repo exists — pulling latest..."
  sudo -u "$APP_USER" git -C "$APP_DIR" pull origin main
else
  sudo -u "$APP_USER" git clone https://github.com/twaldin/claudecord "$APP_DIR"
fi

# Install dependencies
echo "Installing npm dependencies..."
sudo -u "$APP_USER" bash -c "cd $APP_DIR && npm install"

# 6. Environment file
echo "[6/7] Setting up .env..."
if [ ! -f "$APP_DIR/.env" ]; then
  cp "$APP_DIR/.env.example" "$APP_DIR/.env"
  chown "$APP_USER:$APP_USER" "$APP_DIR/.env"
  chmod 600 "$APP_DIR/.env"
  echo ""
  echo "  IMPORTANT: Edit $APP_DIR/.env and set:"
  echo "    DISCORD_BOT_TOKEN=your_token_here"
  echo "    ANTHROPIC_API_KEY=your_key_here"
  echo ""
else
  echo ".env already exists — skipping"
fi

# Routing config
if [ ! -f "$APP_DIR/config/routing.json" ]; then
  cp "$APP_DIR/config/routing.example.json" "$APP_DIR/config/routing.json"
  chown "$APP_USER:$APP_USER" "$APP_DIR/config/routing.json"
  echo "  IMPORTANT: Edit $APP_DIR/config/routing.json with your channel IDs"
fi

# 7. systemd service
echo "[7/7] Installing systemd service..."
SERVICE_FILE="/etc/systemd/system/claudecord.service"
sed "s/{{your_user}}/$APP_USER/g" "$APP_DIR/deploy/claudecord.service" > "$SERVICE_FILE"
systemctl daemon-reload
systemctl enable claudecord

echo ""
echo "=== Setup Complete ==="
echo ""
echo "Next steps:"
echo "  1. Edit $APP_DIR/.env — add DISCORD_BOT_TOKEN and ANTHROPIC_API_KEY"
echo "  2. Edit $APP_DIR/config/routing.json — add your Discord channel IDs"
echo "  3. Start the daemon: systemctl start claudecord"
echo "  4. Start agents:     sudo -u $APP_USER bash $APP_DIR/scripts/start.sh"
echo "  5. Attach to tmux:   sudo -u $APP_USER tmux attach -t claudecord"
echo ""
echo "Logs: journalctl -u claudecord -f"
