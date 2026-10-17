#!/usr/bin/env bash
# Instala/administra la tarea programada (cron) de Prospector IA.
#
#   ./instalar_cron.sh            -> todos los días a las 03:00 (RECOMENDADO)
#   ./instalar_cron.sh 5          -> cada 5 minutos
#   ./instalar_cron.sh 30         -> cada 30 minutos
#   ./instalar_cron.sh 0 6        -> todos los días a las 06:00
#   ./instalar_cron.sh listar     -> ver la tarea
#   ./instalar_cron.sh quitar     -> eliminarla
#
# Nota honesta: cada 5 minutos es MUCHO más de lo necesario y es agresivo con los
# sitios. Una vez por día alcanza y sobra.

set -euo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"
IDENT="$DIR/run_cron.sh"
LOCK="$DIR/salida/.cron.lock"

quitar() {
  crontab -l 2>/dev/null | grep -vF "$IDENT" | crontab - || true
}

case "${1:-}" in
  quitar)
    quitar
    echo "Tarea eliminada."
    exit 0
    ;;
  listar)
    crontab -l 2>/dev/null | grep -F "$IDENT" || echo "No hay tarea instalada."
    exit 0
    ;;
esac

if [ $# -eq 0 ]; then
  SCHED="0 3 * * *"
elif [ $# -eq 1 ]; then
  SCHED="*/$1 * * * *"
else
  SCHED="$2 $1 * * *"
fi

mkdir -p "$DIR/salida"
LINE="$SCHED flock -n $LOCK $IDENT"

quitar
{ crontab -l 2>/dev/null; echo "$LINE"; } | crontab -
echo "Tarea instalada: $SCHED"
echo "Log: $DIR/salida/cron.log"
