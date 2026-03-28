# Things I Forget

Patterns of things that get dropped or done wrong. Review after each compaction and update.
The goal is to make each failure once, not repeatedly.

---

## Template Entry Format

**Pattern:** [what keeps getting forgotten or done wrong]
**When it happens:** [the triggering situation]
**Fix:** [what to do instead]
**First noticed:** [date]
**Still happening?** [yes/no]

---

## Known Patterns

### Crons not recreated after compaction
**Pattern:** Starting a session without recreating crons → heartbeats and briefings stop running.
**When it happens:** After any compaction, especially if startup checklist is rushed.
**Fix:** Step 4 of startup checklist is always recreate crons. Do it before checking Discord. Do it before anything else.
**First noticed:** (template — fill in when you first experience this)
**Still happening?** (template)

### Claiming "fixed" without verifying
**Pattern:** Saying a bug is fixed or a deploy succeeded without actually confirming it.
**When it happens:** When the deploy command exits 0 and no error is visible.
**Fix:** Always say "deployed, please test" unless you ran the verification yourself and saw the expected output.
**First noticed:** (template)
**Still happening?** (template)

### Forgetting to kill ephemeral agents
**Pattern:** Coders accumulate in the registry after their PRs are submitted.
**When it happens:** After a coder reports PR submitted — easy to just move on.
**Fix:** After any coder reports completion, immediately run `kill_teammate <name>`.
**First noticed:** (template)
**Still happening?** (template)

### Not acknowledging before acting
**Pattern:** Starting to work on a user's request without sending an acknowledgment first.
**When it happens:** When the task seems obviously urgent and the impulse is to just do it.
**Fix:** Acknowledgment first, always. Even if it's just "On it."
**First noticed:** (template)
**Still happening?** (template)

---

## How to Use This File

1. After every compaction: read this file. Does any pattern apply to what just happened?
2. If you notice a new pattern: add it immediately, don't wait.
3. Weekly review: check "Still happening?" for each entry. If fixed, mark it.
4. If an entry has been "no" for 4+ weeks, archive it to the bottom.
