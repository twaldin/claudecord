---
name: SKILL
description: "Interactive setup wizard for claudecord. Configures bot token, guild ID, and channel routing. Run once to get claudecord working."
user-invocable: true
---

# /claudecord:setup — Interactive Setup Wizard

Walk the user through connecting claudecord to their Discord server. Work
through the steps below in order. Use AskUserQuestion for each prompt.

## Step 0: Check existing config

Read `~/.claudecord/config.json` if it exists.

```bash
cat ~/.claudecord/config.json 2>/dev/null || echo "not configured"
```

If already configured, show the current values and ask:
> "claudecord is already configured. Do you want to reconfigure it?"

If no → done, remind them to run `/clear` to reload the MCP server.

## Step 1: Create a Discord bot

Tell the user:

> To connect claudecord you need a Discord bot. If you already have one, skip this step.
>
> 1. Go to https://discord.com/developers/applications
> 2. Click **New Application** → give it a name (e.g. "claudecord")
> 3. Go to **Bot** in the left sidebar
> 4. Click **Reset Token** → copy the token (you'll only see it once)
> 5. Enable these **Privileged Gateway Intents**:
>    - Message Content Intent
>    - Server Members Intent (optional, needed for allowlist by username)
> 6. Go to **OAuth2 → URL Generator**
>    - Scopes: `bot`
>    - Bot permissions: `Send Messages`, `Read Messages/View Channels`,
>      `Manage Channels` (for ephemeral channels), `Add Reactions`,
>      `Read Message History`, `Embed Links`
> 7. Copy the generated URL and open it in your browser to invite the bot to your server.

Ask:
> "Paste your bot token:"

Validate: must be non-empty, roughly matches Discord token format (60+ chars).
Save as `discordBotToken` in config.

## Step 2: Guild (server) ID

Tell the user:

> Enable Developer Mode in Discord: Settings → Advanced → Developer Mode.
> Right-click your server name in the sidebar → **Copy Server ID**.

Ask:
> "Paste your Discord server (guild) ID:"

Validate: must be a numeric snowflake (17-20 digits).
Save as `discordGuildId` in config.

## Step 3: Routing — orchestrator channel

Tell the user:

> Right-click the Discord channel where YOU want to talk to the orchestrator
> → **Copy Channel ID**.

Ask:
> "Paste the orchestrator's primary channel ID:"

Validate: numeric snowflake.

Ask:
> "What is your orchestrator agent's name? (default: orchestrator)"

Default to `orchestrator`. This becomes the `primaryAgent` in config and the
routing key in `routing.json`.

## Step 4: Additional agent channels (optional)

Ask:
> "Do you want to map additional channels to agents now? (y/n)"

If yes, loop:

Ask:
> "Agent name (or 'done' to finish):"

If not 'done', ask:
> "Channel ID for [agent_name]:"

Validate channel ID. Continue until 'done'.

## Step 5: HTTP port (optional)

Ask:
> "HTTP side-channel port for reply_discord scripts? (default: 19532)"

Accept default or validate it's a valid port number 1024-65535.

## Step 6: Allowed users (optional)

Tell the user:

> By default claudecord accepts messages from anyone in the channels it
> monitors. You can restrict this to specific Discord user IDs.
>
> Right-click a user in Discord (Developer Mode enabled) → Copy User ID.

Ask:
> "Allowed Discord user IDs? (comma-separated, or leave blank to allow all)"

If blank, leave `allowedUsers` empty (allow all).

## Step 7: Write config

Write config to `~/.claudecord/config.json`:

```bash
mkdir -p ~/.claudecord
chmod 700 ~/.claudecord
```

Config JSON structure:
```json
{
  "discordBotToken": "<token>",
  "discordGuildId": "<guild_id>",
  "primaryAgent": "<name>",
  "httpPort": 19532,
  "allowedUsers": []
}
```

Lock file permissions (token is a credential):
```bash
chmod 600 ~/.claudecord/config.json
```

Write routing to `<project_root>/config/routing.json`:
```json
{
  "agents": {
    "<primaryAgent>": {
      "channels": ["<orchestrator_channel_id>"]
    }
  },
  "defaultAgent": "<primaryAgent>"
}
```

Add any additional agents to the `agents` map.

## Step 8: Test connection

Tell the user you'll test the connection now.

Run a quick connectivity test: use the bash MCP server start command to
verify the token works. The simplest test is to attempt a Discord API call:

```bash
curl -s -H "Authorization: Bot <token>" \
  "https://discord.com/api/v10/users/@me" | \
  grep -q '"username"' && echo "OK" || echo "FAIL"
```

If OK: tell the user the token is valid.
If FAIL: tell the user the token is invalid and ask them to re-enter it
(return to Step 1).

## Step 9: Complete

Tell the user:

> Setup complete! Here's what to do next:
>
> 1. **Restart the MCP server**: run `/clear` in Claude Code to reload it.
>    The claudecord MCP server will start automatically.
>
> 2. **Verify the bot is online**: check your Discord server — the bot
>    should show as online once the MCP server starts.
>
> 3. **Install on orchestrator session only**: claudecord should be enabled
>    in your project's `.claude/settings.json`, NOT in user-scope settings.
>    This prevents agent sessions from starting duplicate bot instances.
>
> 4. **Test it**: send a message to your orchestrator channel. You should
>    see it arrive as a tool call notification.
>
> 5. **Agents reply via script**: add the claudecord `scripts/` directory
>    to your agents' PATH so they can use `reply_discord`.

Show a summary of what was configured:
```
Bot:        <username>
Guild:      <guild_id>
Primary:    <primaryAgent> → #<channel_id>
HTTP port:  <port>
Config:     ~/.claudecord/config.json
Routing:    config/routing.json
```
