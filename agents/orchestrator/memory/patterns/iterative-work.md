# Pattern: Iterative Work (Autonomous Loops)

How to do autonomous, multi-step work without stopping to ask questions at every step.

## The Core Problem

Stopping to ask a question creates a blocking dependency on {{user_name}}. They might be asleep, in a meeting, or just busy. The goal is to do work autonomously and surface decisions only when genuinely blocked.

## Decision Framework

Before stopping to ask, evaluate:

1. **Is this a reversible action?** If yes, proceed and report. If no, pause and ask.
2. **Is the downside of the wrong choice recoverable?** If yes, proceed. If no (data loss, money spent, user-visible regression), pause.
3. **Did the user already answer this implicitly?** Re-read their original request and any relevant memory files. Often the answer is there.
4. **Is this my uncertainty or a real ambiguity?** "I'm not sure which approach is better" is yours to resolve. "I need the user's API key" is a real blocker.

## Autonomous Loop Structure

```
while task not complete:
  1. Plan the next concrete step
  2. Execute it
  3. Verify it worked
  4. If it failed: diagnose → fix → retry (up to 3 times)
  5. If still failing after 3 tries: escalate to user with full context
  6. If it worked: update WORKING.md progress notes
  7. Post incremental update to #code-status if it's worth {{user_name}} knowing
  8. Check: am I blocked on something only the user can provide?
     → yes: ask once, clearly, then move to other work while waiting
     → no: continue loop
```

## When to Post Updates

- At the START of a substantial piece of work (so user knows you're on it)
- At natural milestones (PR opened, tests passing, deploy started)
- At the END (done, here's the result)
- When genuinely blocked (what you need, what you've tried)

Do NOT post updates for every tool call or every micro-step.

## When to Escalate

Only escalate to {{user_name}} when:
- You need something only they can provide (credential, approval, decision with big consequences)
- You've hit the same failure 3 times and can't figure out why
- Something unexpected happened that changes the scope of the task

When you escalate: give full context (what you were trying to do, what happened, what you need, your recommendation if you have one). Don't make them ask for details.

## Handling Agent Failures

If a spawned agent fails or goes quiet:
1. Check its output with `capture_pane <name> 50`
2. If it hit an error, diagnose and either fix + retry or spawn a new one
3. If it's been >30 minutes with no progress, kill and respawn
4. Report to {{user_name}} only if it affects the user-facing outcome

## Parallelism

Multiple independent tasks can be delegated to agents simultaneously:
- Spawn agent A for task A, agent B for task B
- Don't wait for A to finish before starting B
- Check both periodically
- Report combined results when all are done
