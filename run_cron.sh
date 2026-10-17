#!/usr/bin/env bash
# Prospector IA — una corrida automatizada: rota la consulta y actualiza salidas.
# Pensado para cron. Registra todo en salida/cron.log.

set -euo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$DIR"

PY="${PYTHON:-python3}"
LOG="salida/cron.log"
mkdir -p salida

# Elige la consulta de turno (rotando por consultas.txt)
mapfile -t CONSULTAS < <(grep -v '^\s*#' consultas.txt | grep -v '^\s*$' || true)
if [ "${#CONSULTAS[@]}" -eq 0 ]; then
  echo "consultas.txt está vacío" >&2
  exit 1
fi

idx=0
[ -f salida/.consulta_idx ] && idx="$(cat salida/.consulta_idx)"
consulta="${CONSULTAS[$((idx % ${#CONSULTAS[@]}))]}"
echo $(( (idx + 1) % ${#CONSULTAS[@]} )) > salida/.consulta_idx

{
  echo "===== $(date '+%F %T') — consulta: $consulta ====="
  "$PY" run.py buscar "$consulta" --max 20
  echo "--- chequeo de empresas guardadas ---"
  "$PY" run.py check --limite 30
  echo "--- exportando ---"
  "$PY" run.py exportar --tipo full  --salida salida/empresas.csv
  "$PY" run.py exportar --tipo emails --lote 20 --salida salida/emails
  echo
} >>"$LOG" 2>&1
