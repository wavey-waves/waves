#!/usr/bin/env bash
# .claude/lib/session-lock.sh
#
# Cross-window concurrency lock for the .claude/ review workflows.
#
# Multiple Claude windows can be open against the same repo. When the
# coderabbit-fixer fans out (one fixer per target file), two windows that
# both receive the same pasted CodeRabbit comment would otherwise spawn
# competing fixers against the same file — duplicated edits + duplicated
# token spend.
#
# This helper provides a minimal filesystem-only mutex with a TTL. Stale
# locks (older than TTL) are auto-stolen on the next acquire, so a crashed
# window can never deadlock the workflow.
#
# Lock representation: a directory .claude/.locks/<gate>.lock/ (atomic
# mkdir) containing one `owner` file with the line:
#
#   <session_id>|<unix_ts>|<pid>|<note>
#
# Subcommands:
#   acquire <gate> <session_id> [--ttl <seconds>] [--note <text>]
#     Exit 0 on success (fresh lock taken, or a stale lock stolen).
#     Exit 2 if another live session holds it; prints held-by on stderr.
#
#   release <gate> <session_id>
#     Removes the lock only if owned by session_id. Idempotent.
#
#   status <gate>
#     Prints "free" or "held-by:<session_id>|age=<s>s|note=<text>". Exit 0.
#
# Gate convention: the coderabbit-fixer uses `cr-fixer:<file-sha1-12>` so
# each target file gets its own lock. Default TTL 600s (10 min).

set -u

repo_root="$(git rev-parse --show-toplevel 2>/dev/null)" || {
  echo "session-lock.sh: not inside a git repo" >&2
  exit 1
}

lock_root="$repo_root/.claude/.locks"
mkdir -p "$lock_root" 2>/dev/null || true

default_ttl_for() {
  case "$1" in
    cr-fixer:*) echo 600 ;;
    *)          echo 600 ;;
  esac
}

lock_dir_for() {
  # Slashes in the gate name (e.g. cr-fixer:...) are fine in a dir name on
  # Linux except the path separator — replace `/` defensively.
  printf '%s/%s.lock' "$lock_root" "${1//\//_}"
}

now_unix() { date -u +%s; }

read_owner_file() {
  local owner_path="$1"
  if [ -f "$owner_path" ]; then
    head -n 1 "$owner_path" 2>/dev/null
  fi
}

cmd_status() {
  local gate="$1"
  local lock_d
  lock_d="$(lock_dir_for "$gate")"
  if [ ! -d "$lock_d" ]; then
    echo "free"
    return 0
  fi
  local owner_line
  owner_line="$(read_owner_file "$lock_d/owner")"
  if [ -z "$owner_line" ]; then
    echo "free"
    return 0
  fi
  local owner_sid owner_ts owner_pid owner_note
  owner_sid="$(echo "$owner_line" | awk -F'|' '{print $1}')"
  owner_ts="$(echo "$owner_line" | awk -F'|' '{print $2}')"
  owner_pid="$(echo "$owner_line" | awk -F'|' '{print $3}')"
  owner_note="$(echo "$owner_line" | awk -F'|' '{ for (i=4; i<=NF; i++) printf "%s%s", $i, (i==NF?"":"|") }')"
  if ! [[ "$owner_ts" =~ ^[0-9]+$ ]]; then
    echo "session-lock: malformed owner timestamp for ${gate} — treating as free" >&2
    echo "free"
    return 0
  fi
  local age=$(( $(now_unix) - owner_ts ))
  echo "held-by:${owner_sid}|age=${age}s|pid=${owner_pid}|note=${owner_note}"
}

cmd_acquire() {
  local gate="$1"
  local sid="$2"
  shift 2
  local ttl
  ttl="$(default_ttl_for "$gate")"
  local note=""
  while [ $# -gt 0 ]; do
    case "$1" in
      --ttl)      ttl="$2"; shift 2 ;;
      --ttl=*)    ttl="${1#--ttl=}"; shift ;;
      --note)     note="$2"; shift 2 ;;
      --note=*)   note="${1#--note=}"; shift ;;
      *)          shift ;;
    esac
  done

  local lock_d
  lock_d="$(lock_dir_for "$gate")"

  # Atomic mkdir attempt.
  if mkdir "$lock_d" 2>/dev/null; then
    printf '%s|%s|%s|%s\n' "$sid" "$(now_unix)" "$$" "$note" > "$lock_d/owner"
    return 0
  fi

  # Lock exists. Inspect it.
  local owner_line owner_sid owner_ts
  owner_line="$(read_owner_file "$lock_d/owner")"
  if [ -z "$owner_line" ]; then
    # Stale empty lock dir — claim it.
    printf '%s|%s|%s|%s\n' "$sid" "$(now_unix)" "$$" "$note" > "$lock_d/owner"
    echo "session-lock: claimed empty stale lock for ${gate}" >&2
    return 0
  fi
  owner_sid="$(echo "$owner_line" | awk -F'|' '{print $1}')"
  owner_ts="$(echo "$owner_line" | awk -F'|' '{print $2}')"

  # Same-session re-acquire is idempotent — refresh the timestamp.
  if [ "$owner_sid" = "$sid" ]; then
    printf '%s|%s|%s|%s\n' "$sid" "$(now_unix)" "$$" "$note" > "$lock_d/owner"
    return 0
  fi

  if ! [[ "$owner_ts" =~ ^[0-9]+$ ]]; then
    echo "session-lock: malformed owner timestamp for ${gate} — stealing lock" >&2
    printf '%s|%s|%s|%s\n' "$sid" "$(now_unix)" "$$" "$note" > "$lock_d/owner"
    return 0
  fi

  local age=$(( $(now_unix) - owner_ts ))
  if [ "$age" -gt "$ttl" ]; then
    # Stale — steal it.
    printf '%s|%s|%s|%s\n' "$sid" "$(now_unix)" "$$" "$note" > "$lock_d/owner"
    echo "session-lock: stole stale lock for ${gate} (was held by ${owner_sid}, age=${age}s, ttl=${ttl}s)" >&2
    return 0
  fi

  echo "session-lock: ${gate} held-by:${owner_sid}|age=${age}s|ttl=${ttl}s" >&2
  return 2
}

cmd_release() {
  local gate="$1"
  local sid="$2"
  local lock_d
  lock_d="$(lock_dir_for "$gate")"
  if [ ! -d "$lock_d" ]; then
    return 0
  fi
  local owner_line owner_sid
  owner_line="$(read_owner_file "$lock_d/owner")"
  owner_sid="$(echo "$owner_line" | awk -F'|' '{print $1}')"
  if [ -z "$owner_sid" ] || [ "$owner_sid" = "$sid" ]; then
    rm -f "$lock_d/owner" 2>/dev/null
    rmdir "$lock_d" 2>/dev/null || true
    return 0
  fi
  echo "session-lock: refusing to release ${gate} (held by ${owner_sid}, not ${sid})" >&2
  return 1
}

main() {
  local sub="${1:-}"
  [ $# -gt 0 ] && shift
  case "$sub" in
    acquire)
      if [ $# -lt 2 ]; then
        echo "usage: session-lock.sh acquire <gate> <session_id> [--ttl N] [--note TEXT]" >&2
        exit 1
      fi
      cmd_acquire "$@"
      ;;
    release)
      if [ $# -lt 2 ]; then
        echo "usage: session-lock.sh release <gate> <session_id>" >&2
        exit 1
      fi
      cmd_release "$@"
      ;;
    status)
      if [ $# -lt 1 ]; then
        echo "usage: session-lock.sh status <gate>" >&2
        exit 1
      fi
      cmd_status "$@"
      ;;
    "")
      echo "usage: session-lock.sh {acquire|release|status} <gate> [...]" >&2
      exit 1
      ;;
    *)
      echo "session-lock.sh: unknown subcommand '$sub'" >&2
      exit 1
      ;;
  esac
}

main "$@"
