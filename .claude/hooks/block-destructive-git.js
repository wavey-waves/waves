#!/usr/bin/env node
/**
 * PreToolUse(Bash) hook — denies destructive / shared-state git operations
 * before they execute. This is a guardrail (not a moat) protecting the
 * working tree from accidental data loss: a stray `git reset --hard` or
 * `git checkout .` silently discards uncommitted work, and force-push or
 * `git commit` are reserved for the user per CLAUDE.md "Git".
 *
 * Denied verbs:
 *   stash / stash pop / stash apply / stash drop / stash clear
 *   reset (--hard / --merge / --keep) / restore . / restore -- <path>
 *   checkout . / checkout -- <path> / clean -f / clean -fd / clean -fx
 *   rebase / merge / cherry-pick / revert
 *   branch -D / branch --delete --force
 *   push --force / push --force-with-lease / push -f
 *   commit (any form) / config <write>
 *
 * Read-only git commands (status, diff, log, show, blame, rev-parse,
 * ls-files, config --get) are not matched and proceed normally.
 *
 * On a match, emits the hook-spec deny JSON which prevents the Bash call
 * from executing and feeds `reason` back to the model so it can rethink.
 */

const fs = require("fs");

function readStdin() {
  try {
    return fs.readFileSync(0, "utf8");
  } catch (_e) {
    return "";
  }
}

let input;
try {
  input = JSON.parse(readStdin());
} catch (_e) {
  process.exit(0);
}

const cmd = (input && input.tool_input && input.tool_input.command) || "";
if (!cmd) process.exit(0);

// Strip leading `cd ... &&` / `pushd ... &&` so we match the real verb.
// Also normalise `git -C <path> <verb>` → `git <verb>` so forbidden verbs
// are still caught when an absolute path is supplied instead of a `cd`.
const normalized = cmd
  .replace(/^\s*cd\s+[^&;]+&&\s*/g, "")
  .replace(/^\s*pushd\s+[^&;]+&&\s*/g, "")
  .replace(/\bgit\s+-C\s+\S+\s+/g, "git ");

// Each rule = a regex matched against the full command string + a short
// label for the deny reason. Patterns are intentionally permissive about
// whitespace and chained-with-`&&` forms.
const FORBIDDEN = [
  [/\bgit\s+stash(?:\s+(pop|apply|drop|clear|push|save))?\b/, "git stash (any subcommand)"],
  [/\bgit\s+reset\s+(--hard|--merge|--keep)\b/, "git reset --hard / --merge / --keep"],
  [/\bgit\s+restore\s+\./, "git restore ."],
  [/\bgit\s+restore\s+--/, "git restore -- <path>"],
  [/\bgit\s+checkout\s+\./, "git checkout ."],
  [/\bgit\s+checkout\s+--/, "git checkout -- <path>"],
  [/\bgit\s+clean\s+-[a-zA-Z]*f/, "git clean -f"],
  [/\bgit\s+rebase\b/, "git rebase"],
  [/\bgit\s+merge\b(?!\-)/, "git merge"],
  [/\bgit\s+cherry-pick\b/, "git cherry-pick"],
  [/\bgit\s+revert\b/, "git revert"],
  [/\bgit\s+branch\s+(-D|--delete\s+--force|-d\s+-f)/, "git branch -D / --delete --force"],
  [/\bgit\s+push\s+(.*\s+)?(-f\b|--force\b|--force-with-lease\b)/, "git push --force"],
  [/\bgit\s+commit\b/, "git commit"],
  [/\bgit\s+config\s+(--global|--system|--local|--file|--add|--replace-all|--unset|--unset-all|--remove-section|--rename-section)\b/, "git config (write)"],
  // Also catch the bare two-argument write form `git config <key> <value>`
  // (e.g. `git config user.name "Alice"`). The `[^\s-]` excludes read flags
  // like `--get`/`--list`; the trailing `\s+` requires a value to follow, so
  // value-less reads (`git config user.name`) are not blocked.
  [/\bgit\s+config\s+[^\s-][^\s]*\s+/, "git config (write)"],
];

for (const [re, label] of FORBIDDEN) {
  if (re.test(normalized)) {
    const reason =
      `[block-destructive-git] Bash command rejected: ${label}. ` +
      `Per CLAUDE.md "Git", destructive / shared-state git operations are ` +
      `blocked to protect uncommitted work, and commit/push are reserved ` +
      `for the user. Read-only git inspection (status, diff, log, show, ` +
      `blame, rev-parse, ls-files, config --get) is allowed. ` +
      `If the user has explicitly requested this operation for this turn, ` +
      `they can re-issue the request (it's a guardrail, not a moat). ` +
      `Command that was blocked: \`${cmd.slice(0, 200)}\``;
    process.stdout.write(
      JSON.stringify({ decision: "block", reason }) + "\n"
    );
    process.exit(0);
  }
}

process.exit(0);
