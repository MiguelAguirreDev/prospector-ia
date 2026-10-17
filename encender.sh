#!/usr/bin/env bash
# Enciende la interfaz de Prospector IA en el navegador.
# Doble clic sobre este archivo, o desde la terminal: ./encender.sh
set -u
cd "$(dirname "$(readlink -f "$0")")" || exit 1

if ! command -v python3 >/dev/null 2>&1; then
  echo "No encontré python3. Instalalo y volvé a intentar."
  read -r -p "Enter para cerrar..."
  exit 1
fi

exec python3 -u app.py
