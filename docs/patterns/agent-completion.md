# Pattern: Agent Completion

Ephemeral agents (coders, researchers) must complete cleanly. This pattern defines how agents finish work without leaving loose ends.

## The Problem

An agent that just stops — without reporting results or cleaning up — leaves the orchestrator guessing. Did it finish? Did it error? Is the PR ready to review?

## Completion Protocol

Every ephemeral agent follows this sequence to complete:

### 1. Verify work is done

Before reporting completion, verify:
- Tests pass
- PR is created (if applicable)
- Output files exist (if applicable)
- No uncommitted changes left in the working directory

```bash
git status          # Should be clean
npm test            # Should pass
gh pr view HEAD     # If PR work — should show the PR
```

### 2. Report to orchestrator

```bash
message_orchestrator "Task complete. <one-sentence summary>. <link or reference>"
```

Examples:
```bash
message_orchestrator "Fix for issue #42 complete. PR #43 created — adds input validation to /api/upload."
message_orchestrator "Research on competitor pricing complete. Findings at research/2026-03-28-pricing.md"
message_orchestrator "BLOCKED: Can't reproduce issue #45 — the bug requires a database state I don't have. Need clarification."
```

### 3. Post to Discord (if user-visible work)

For work the user cares about:
```python
claudecord_reply(
  chat_id="{{channel_code_status_id}}",
  text="PR #43 ready for review: adds input validation to /api/upload. Fixes #42."
)
```

For background work: skip this — orchestrator will summarize if needed.

### 4. Exit

```
/exit
```

**Do not** linger. Persistent agents accumulate context cost; ephemeral agents should exit as soon as work is done.

## Failure Protocol

If an agent hits an unrecoverable error:

```bash
message_orchestrator "FAILED: <what failed> — <why> — <what was partially done>"
```

Then exit. Don't leave partial work uncommitted or open PRs in broken state.

Partially done work:
- Commit whatever is safe to commit with a `WIP:` prefix
- Create a draft PR if needed to preserve the branch
- Include the WIP commit hash in your message to the orchestrator

## Worktree Cleanup

Coders spawned with `spawn_coder` work in `/tmp/claudecord-wt-<issue>`. After the PR is merged, the orchestrator should clean up:

```bash
git worktree remove /tmp/claudecord-wt-42 --force
```

Or the evaluator can do this as part of post-merge cleanup.

## State After Completion

The orchestrator updates its `state.md` when an agent reports completion:

```markdown
## Completed today
- coder-fix-42: PR #43 created (awaiting evaluator)
- researcher: pricing analysis delivered
```

This ensures completion is tracked across compactions.
