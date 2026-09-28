#!/usr/bin/env bash
# Rebuild a scratch database from the migrations + seed and run the SQL tests.
#   scripts/sql-test.sh                      all tests
#   scripts/sql-test.sh supabase/tests/10_pick_audit.sql
# Local Postgres only (default user postgres); never points at Supabase.
set -euo pipefail
shopt -s nullglob
cd "$(dirname "$0")/.."
export PGUSER="${PGUSER:-postgres}"
db="${SQL_TEST_DB:-k1_sql_test}"
log="$(mktemp)"; trap 'rm -f "$log"' EXIT

psql -d postgres -q -c "drop database if exists $db" -c "create database $db" >/dev/null
export PGDATABASE="$db"
psql -q -v ON_ERROR_STOP=1 -f supabase/tests/00_local_auth_stub.sql >/dev/null
for f in supabase/migrations/*.sql; do
  psql -q -v ON_ERROR_STOP=1 -f "$f" >/dev/null 2>"$log" || { echo "migration failed: $f"; cat "$log"; exit 1; }
done
psql -q -v ON_ERROR_STOP=1 -f supabase/seed.sql >/dev/null
# 01 grants table rights and shows expected errors; it is read by eye, not asserted.
psql -q -f supabase/tests/01_rls_and_stock_rules.sql >/dev/null 2>&1 || true

tests=("$@")
[ ${#tests[@]} -eq 0 ] && tests=(supabase/tests/0[2-9]_*.sql supabase/tests/1[0-9]_*.sql)
status=0
for t in "${tests[@]}"; do
  if ! out=$(psql -v ON_ERROR_STOP=1 -f "$t" 2>&1); then
    echo "ERROR in $t"; grep -E "ERROR|FAIL" <<<"$out" || true; status=1; continue
  fi
  pass=$(grep -c "NOTICE:  PASS" <<<"$out" || true)
  fail=$(grep -c "NOTICE:  FAIL" <<<"$out" || true)
  echo "$t: $pass PASS, $fail FAIL"
  if [ "$fail" -ne 0 ]; then grep "NOTICE:  FAIL" <<<"$out"; status=1; fi
done
exit $status
