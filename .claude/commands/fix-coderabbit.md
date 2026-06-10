---
description: Apply CodeRabbit (or other automated reviewer) suggestions on the current branch's PR. Accepts a PR number to fetch comments via `gh`, or accepts pasted comments inline. Delegates to the coderabbit-fixer agent, which applies SAFE fixes automatically, surfaces STRUCTURAL ones for user decision, and ALWAYS asks before touching branch-intent regions (feature flags, disabled features, experiments).
---

You are about to run the **/fix-coderabbit** workflow.

## Step 1 — Determine input mode

`$ARGUMENTS` is one of:

- **A PR number** (e.g. `40` or `#40`) — Mode B: fetch comments via `gh`.
- **Pasted comment text** (multi-line markdown/JSON) — Mode A: use directly.
- **Empty** — ask once: "Paste the CodeRabbit comments or give me a PR number," then wait.

## Step 2 — Dispatch to the coderabbit-fixer agent

In **Mode B**, first pull both comment layers (see `.claude/agents/coderabbit-fixer.md` → "Mode B — fetch comments"): inline review threads via the GraphQL `reviewThreads` query (filter out resolved/outdated, keep only `coderabbitai[bot]`), plus the cover-letter review bodies (`Outside diff range comments` + `Nitpick comments` sections). Merge into one list, each item carrying a `comment_databaseId` (inline) or `null` (cover-letter).

Group the records by target file, then maintain an **in-flight CR-fixer registry** (`{ target_file → agent_id }`, conversation state — not a file). For each distinct target file:

1. **Acquire a per-file lock** so a duplicate paste in another Claude window can't spawn a competing fixer:
   ```bash
   # `sha1sum` (GNU) isn't on every platform; fall back to `shasum -a 1` (macOS/BSD).
   bash .claude/lib/session-lock.sh acquire "cr-fixer:$(printf '%s' '<path>' | { sha1sum 2>/dev/null || shasum -a 1; } | cut -c1-12)" "$CLAUDE_SESSION_ID" --note '<path>'
   ```
   If acquire fails (exit 2), another window owns that file — skip it with a "deferring to other window" note and move on.
2. **No in-flight fixer for that file** → spawn a fresh `coderabbit-fixer` with `run_in_background: true`, passing `CR_LOCK_KEY` + `CR_SESSION_ID` in the prompt so the fixer releases the lock on exit. Add it to the registry.
3. **An in-flight fixer already owns that file** → forward the new comment to that instance via `SendMessage` (it accepts per its "Concurrency model").

**Pair every backgrounded spawn with a Monitor.** Each `Agent(..., run_in_background: true)` call MUST be paired — in the same message — with `Monitor` pointed at `bash .claude/scripts/agent-progress-monitor.sh <output_file>`, so the user sees live progress instead of a silent multi-minute wait. N new fixers → N Agent + N Monitor calls in one message. When spawning fixers for several files, batch all the Agent+Monitor calls into a single message so they run concurrently.

Each fixer owns one file and runs its full workflow: categorize SAFE / STRUCTURAL / FLAGGED / AMBIGUOUS, present the plan, apply SAFE fixes, ask via `AskUserQuestion` for STRUCTURAL and FLAGGED items, verify with `npm run lint`, and (Mode B, non-null `comment_databaseId` only) post one reply per addressed comment.

If a comment's target file can't be parsed, dispatch it as a single-comment run.

## Step 3 — Announce the dispatch, then report status

Emit one short line per spawn / forward:
- `Spawning coderabbit-fixer (background) for <file> — <count> comment(s)`
- `Forwarding 1 CR comment to in-flight fixer owning <file>`

Do NOT block. Return control to the user immediately. **Every subsequent turn while any fixer is alive, include a `## In-flight` block** listing each fixer with its target file, elapsed time, latest activity (refresh via `TaskOutput`), and — for Mode B — a running `replies posted: N/M` counter. On completion, relay each fixer's final report once and drop it from the registry. If a fixer raised an `AskUserQuestion`, the branch-intent / structural decision waits for the user.

## Important

- **Branch-intent guardrail is non-negotiable** — if a fixer flags a region, wait for the user's answer; never auto-apply a flagged region.
- **Monitor pairing is non-optional** — a backgrounded fixer with no Monitor is a silent black box and stalls go undiagnosed.
- **Do NOT commit or push** — the user reviews and commits (per CLAUDE.md "Git"; the `block-destructive-git` hook also enforces this).
- **Drip-fed comments** — if the user pastes more CodeRabbit comments later, the `UserPromptSubmit` hook re-fires and you re-run this dispatch (forwarding to live same-file fixers via `SendMessage`); no need to re-type `/fix-coderabbit`.
