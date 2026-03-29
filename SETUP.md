# Claudecord — First-Time Setup

You are helping a new user configure Claudecord. Walk through each step conversationally — ask one question at a time, wait for the answer, then move to the next step. Do not rush ahead.

## Step 1 — Name your AI

Ask:

> Welcome to Claudecord! What would you like to name your AI assistant?
> (This becomes your orchestrator's identity and home directory — e.g. `jarvis`, `aria`, `atlas`. Lowercase, no spaces.)

Store the answer as `AI_NAME`.

## Step 2 — Discord Bot Token

Tell the user:

> I need a Discord bot token. Here's how to get one:
>
> 1. Go to https://discord.com/developers/applications
> 2. Click **New Application** → name it after your AI
> 3. Go to **Bot** tab → **Reset Token** → copy the token
> 4. Under **Privileged Gateway Intents**, enable:
>    - Message Content Intent
>    - Server Members Intent
> 5. Go to **OAuth2** → **URL Generator**
>    - Scopes: `bot`, `applications.commands`
>    - Bot Permissions: Send Messages, Manage Channels, Manage Roles, Add Reactions, Read Message History, Embed Links
> 6. Copy the generated URL → open it in a browser → invite the bot to your server

Ask: "Paste your bot token:"

Store as `DISCORD_TOKEN`.

## Step 3 — Anthropic API Key

Ask: "Paste your Anthropic API key (starts with `sk-ant-`):"

Store as `ANTHROPIC_API_KEY`.

## Step 4 — Discord Server ID

Tell the user:

> Enable Developer Mode in Discord: **Settings → Advanced → Developer Mode**. Then right-click your server icon and choose **Copy Server ID**.

Ask: "What's your Discord server ID?"

Store as `GUILD_ID`.

## Step 5 — Discord Channels

Tell the user:

> Create these channels in your Discord server, then right-click each one and choose **Copy Channel ID**:
>
> - `#main` — your AI's inbox (messages here go to the orchestrator)
> - `#alerts` — urgent notifications
> - `#code-status` — agent task updates and PR summaries
> - `#status` — live agent dashboard (auto-updates)

Ask for each in sequence:

1. "Paste the `#main` channel ID:" → store as `CHANNEL_MAIN`
2. "Paste the `#alerts` channel ID:" → store as `CHANNEL_ALERTS`
3. "Paste the `#code-status` channel ID:" → store as `CHANNEL_CODE_STATUS`
4. "Paste the `#status` channel ID:" → store as `CHANNEL_STATUS`

## Step 6 — Choose Agent Types

Ask:

> Which agent types do you want?
>
> - **coder** — spawned per coding task, writes tests, opens PRs, exits when done
> - **evaluator** — reviews PRs adversarially, triggers deploys
> - **researcher** — web research and structured reports
> - **reviewer** — full codebase audits on demand
>
> Type agent names comma-separated, or `all`:

Store as `AGENTS` (treat empty or `all` as `coder,evaluator,researcher,reviewer`).

## Step 7 — Run Setup

Say: "Setup complete! Creating your AI team now..."

Run the setup wizard with all collected values:

```bash
WIZARD_AI_NAME="<AI_NAME>" \
WIZARD_DISCORD_TOKEN="<DISCORD_TOKEN>" \
WIZARD_ANTHROPIC_KEY="<ANTHROPIC_API_KEY>" \
WIZARD_GUILD_ID="<GUILD_ID>" \
WIZARD_CHANNEL_MAIN="<CHANNEL_MAIN>" \
WIZARD_CHANNEL_ALERTS="<CHANNEL_ALERTS>" \
WIZARD_CHANNEL_CODE_STATUS="<CHANNEL_CODE_STATUS>" \
WIZARD_CHANNEL_STATUS="<CHANNEL_STATUS>" \
WIZARD_AGENTS="<AGENTS>" \
bash scripts/tools/setup_wizard
```

## Step 8 — Self-Cleanup

After setup_wizard completes successfully:

1. Delete this file: `rm SETUP.md`
2. Remove the setup check from CLAUDE.md: edit CLAUDE.md to remove the "First-Run Check" section (the first 4 lines)
3. Tell the user: "Setup complete! Your AI team is running. Message your bot in Discord to get started."
