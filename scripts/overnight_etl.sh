#!/usr/bin/env bash
# Overnight ETL orchestration — continues after FIDE XML and TWIC finish,
# then runs batch_pairs + post-processing + smoke test.
#
# Usage (from repo root):
#   bash scripts/overnight_etl.sh
#
# The script is idempotent: it looks at DB state and file system to decide
# what still needs running. Safe to re-run if something crashes mid-way.

set -u   # don't use -e — we want steps to continue past individual failures
cd "$(dirname "$0")/.."

mkdir -p logs
RUN_TAG="$(date +%Y%m%d-%H%M%S)"
LOG="logs/overnight-${RUN_TAG}.log"

PY="/c/Users/tommaso/miniconda3/envs/chess-distance-py/python.exe"
FLY="/c/Users/tommaso/.fly/bin/flyctl.exe"
DB_URL='postgres://postgres:qN6rU4o4mZzAorH@127.0.0.1:5432/postgres'

log() { echo "[$(date '+%H:%M:%S')] $*" | tee -a "$LOG"; }

# ── Proxy supervision ──────────────────────────────────────────────────────
# The flyctl proxy drops occasionally (WireGuard churn). We need it alive for
# every DB-touching step, so respawn on demand.
ensure_proxy() {
  if powershell.exe -NoProfile -Command "(Get-NetTCPConnection -LocalPort 5432 -State Listen -ErrorAction SilentlyContinue)" 2>/dev/null | grep -q '5432'; then
    return 0
  fi
  log "proxy: not listening, (re)starting"
  "$FLY" proxy 5432:5432 -a chess-distance-db > /tmp/fly-proxy.log 2>&1 &
  for _ in $(seq 1 20); do
    sleep 2
    if powershell.exe -NoProfile -Command "(Get-NetTCPConnection -LocalPort 5432 -State Listen -ErrorAction SilentlyContinue)" 2>/dev/null | grep -q '5432'; then
      log "proxy: up"; return 0
    fi
  done
  log "proxy: FAILED to come up"; return 1
}

# Wait until a background python -m etl.X command is no longer running.
wait_for_python_module() {
  local module="$1"; local label="$2"
  while powershell.exe -NoProfile -Command "Get-CimInstance Win32_Process -Filter \"CommandLine LIKE '%etl.$module%'\" | Measure-Object | Select -ExpandProperty Count" 2>/dev/null | grep -q '^[1-9]'; do
    sleep 30
  done
  log "waited: $label finished"
}

export DATABASE_URL="$DB_URL"
export PYTHONIOENCODING=utf-8   # fix Windows cp1252 choking on ✓ in TWIC script

log "=== overnight ETL start (tag ${RUN_TAG}) ==="

# ── 1. Wait for FIDE XML upsert to finish (started earlier) ───────────────
log "step 1: waiting for FIDE XML upsert"
wait_for_python_module "download_fide_xml" "FIDE upsert"

# ── 2. Wait for TWIC download to finish (started earlier) ─────────────────
log "step 2: waiting for TWIC download"
wait_for_python_module "download_twic" "TWIC download"
TWIC_FILES=$(ls data/pgn/*.pgn 2>/dev/null | wc -l)
log "  TWIC PGN files on disk: ${TWIC_FILES}"

# ── 3. batch_pairs — parse PGNs, upsert opponent pairs ────────────────────
log "step 3: batch_pairs"
ensure_proxy
"$PY" -m etl.batch_pairs >> "$LOG" 2>&1 && log "  batch_pairs OK" || log "  batch_pairs FAILED"

# ── 4. Post-processing ────────────────────────────────────────────────────
log "step 4: cleanup_data"
ensure_proxy
"$PY" -m etl.cleanup_data >> "$LOG" 2>&1 && log "  cleanup_data OK" || log "  cleanup_data FAILED"

log "step 5: set_historical_dates"
ensure_proxy
"$PY" -m etl.set_historical_dates >> "$LOG" 2>&1 && log "  set_historical_dates OK" || log "  set_historical_dates FAILED"

log "step 6: validate_data --fix"
ensure_proxy
"$PY" -m etl.validate_data --fix >> "$LOG" 2>&1 && log "  validate_data OK" || log "  validate_data FAILED"

log "step 7: add_slugs"
ensure_proxy
"$PY" -m etl.add_slugs >> "$LOG" 2>&1 && log "  add_slugs OK" || log "  add_slugs FAILED"

# dedup is slow and a known-fragile step; run it last so partial progress
# on the rest of the pipeline isn't held hostage by it.
log "step 8: deduplicate_players (dry-run only — real run needs human review)"
ensure_proxy
"$PY" -m etl.deduplicate_players --dry-run >> "$LOG" 2>&1 && log "  dedup dry-run OK" || log "  dedup dry-run FAILED"

# ── 9. Final verification ──────────────────────────────────────────────────
log "step 9: verify_chain"
ensure_proxy
"$PY" -m etl.verify_chain >> "$LOG" 2>&1 && log "  verify_chain OK" || log "  verify_chain FAILED"

log "step 10: restart Fly backend so graph cache reloads with new data"
"$FLY" machines list -a chess-distance-api --json 2>/dev/null \
  | "$PY" -c "import sys,json; [print(m['id']) for m in json.load(sys.stdin)]" \
  | while read -r mid; do
      "$FLY" machine restart "$mid" -a chess-distance-api >> "$LOG" 2>&1 || log "  restart $mid failed"
  done

# Give the backend a minute to pre-warm, then smoke it.
sleep 60
log "step 11: smoke test against deployed Fly API + Vercel"
cd /c/Users/tommaso/Documents/chess-distance
npx tsx scripts/smoke-deploy.ts --api=https://chess-distance-api.fly.dev >> "$LOG" 2>&1 \
  && log "  smoke OK" || log "  smoke FAILED (see above)"

log "=== overnight ETL end ==="
echo "---- summary ----" >> "$LOG"
ensure_proxy && "$PY" -c "
import os, psycopg
os.environ['DATABASE_URL']='$DB_URL'
from etl.db import get_conn
with get_conn() as c, c.cursor() as cur:
    cur.execute('SELECT (SELECT count(*) FROM players), (SELECT count(*) FROM opponents), (SELECT coalesce(sum(game_count),0) FROM opponents)')
    p,o,g=cur.fetchone()
    print(f'players={p:,} opponents={o:,} games={g:,}')
" >> "$LOG" 2>&1

log "log: $LOG"
