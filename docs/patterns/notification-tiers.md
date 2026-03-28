# Pattern: Notification Tiers

Not all agent activity warrants a Discord notification. This pattern defines when agents should notify the user vs. stay silent.

## The Problem

A naive multi-agent system where every agent posts every update quickly becomes noise. The user gets pinged for routine work they don't need to act on, and important notifications get lost.

## Tier Structure

### Tier 0: Silent
No Discord notification. Agent just does the work.

- Routine cron work (heartbeat, health checks)
- In-progress steps within a larger task
- Internal agent-to-agent coordination
- Retrying a transient failure

### Tier 1: Channel post (no ping)
Agent posts to its designated channel. User can check at their own pace.

- Task completion (PR created, research delivered)
- Review verdict (PR approved/rejected with summary)
- Deploy confirmation
- Non-urgent findings from architect review

```python
claudecord_reply(chat_id=CHANNEL_ID, text="PR #42 merged and deployed.")
```

### Tier 2: Mention (soft ping)
Agent mentions the user in a channel post. Triggers a notification.

- Work is blocked and needs user input
- A decision requires human judgment
- Something surprising happened that changes the plan
- Agent needs credentials or access it doesn't have

```python
claudecord_reply(
  chat_id=CHANNEL_ID,
  text="@{{user_name}} PR #43 has a merge conflict I can't resolve — the schema migration in branch A conflicts with branch B. Which should take precedence?"
)
```

### Tier 3: DM / urgent channel
For critical issues that can't wait.

- Production is broken
- Security issue found
- Data loss risk
- External service is down and blocking all work

Post to a designated urgent channel or DM the user directly.

## Rules of Thumb

**Would the user be glad they saw this immediately?**
- Yes → Tier 2+
- Eventually, yes → Tier 1
- Probably not → Tier 0

**Is the user blocked or is the agent blocked?**
- Agent blocked, user can unblock → Tier 2
- Agent handling it → Tier 0 or 1 on completion

**Is this a status update or a question?**
- Status update → Tier 1 (or 0 if routine)
- Question requiring user action → Tier 2

## Implementation

Agents should define their notification policy in `CLAUDE.md`:

```markdown
## Notifications
- Task complete: Tier 1 — post to #{{channel_name}}
- Blocked: Tier 2 — mention {{user_name}} in #{{channel_name}}
- Deploy success: Tier 1 — post to #code-status
- Security finding: Tier 2 — mention {{user_name}} immediately
```

The orchestrator is the notification router. Sub-agents typically message the orchestrator, which decides whether to escalate to Discord.
