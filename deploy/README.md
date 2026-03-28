# Deploy to VPS

Run locally on your laptop, or deploy to a VPS for 24/7 always-on operation. Businesses using Claudecord for continuous monitoring, automated coding pipelines, or customer-facing bots will want a VPS so agents keep running when the laptop is closed.

## Requirements

- Ubuntu 22.04+ or Debian 12+ (tested)
- 2GB RAM minimum (4GB recommended for multiple agents)
- A Discord bot token
- An Anthropic API key

## One-Shot Setup

```bash
# As root on a fresh VPS:
curl -fsSL https://raw.githubusercontent.com/twaldin/claudecord/main/deploy/setup-vps.sh | bash
```

This installs Node.js, Claude Code CLI, clones the repo, creates a service user, and installs the systemd service.

## Manual Setup

```bash
# 1. Install Node.js 22+
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo bash -
sudo apt-get install -y nodejs tmux git

# 2. Install Claude Code
npm install -g @anthropic-ai/claude-code

# 3. Clone repo
git clone https://github.com/twaldin/claudecord ~/claudecord
cd ~/claudecord && npm install

# 4. Configure
cp .env.example .env
nano .env  # Add DISCORD_BOT_TOKEN and ANTHROPIC_API_KEY

cp config/routing.example.json config/routing.json
nano config/routing.json  # Add your Discord channel IDs

# 5. Install and start daemon service
sudo cp deploy/claudecord.service /etc/systemd/system/
sudo sed -i "s/{{your_user}}/$USER/g" /etc/systemd/system/claudecord.service
sudo systemctl daemon-reload
sudo systemctl enable --now claudecord

# 6. Start agents in tmux
bash scripts/start.sh
```

## Systemd Service

The daemon (`src/daemon/index.ts`) runs as a systemd service for automatic restart on failure:

```bash
# View logs
journalctl -u claudecord -f

# Status
systemctl status claudecord

# Restart
systemctl restart claudecord
```

The daemon handles Discord connectivity and message routing. It's lightweight and can restart in seconds without losing messages (agents buffer on reconnect).

## Agents in tmux

Agents run in a tmux session managed by `scripts/start.sh`. tmux keeps them alive through SSH disconnections:

```bash
# Start all agents
bash scripts/start.sh

# Attach to view
tmux attach -t claudecord

# Detach (leave running)
Ctrl-B d
```

## Recommended VPS Providers

Any VPS works. For reference, a 2 vCPU / 4GB RAM instance on any major provider is sufficient for 3-5 concurrent agents.

## Updating

```bash
git pull origin main
npm install
systemctl restart claudecord
# Agents will receive updated CLAUDE.md on next compaction
```
