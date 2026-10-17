#!/usr/bin/env bash
# ============================================================
#  Prospector IA (Web) - lanzador
#  Enciende el servidor y abre el navegador en la interfaz.
# ============================================================
set -u
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$DIR" || exit 1

echo "================================================="
echo "   Prospector IA (Web)   ->   http://127.0.0.1:3000"
echo "================================================="
echo

# ¿Ya está encendido?
if curl -s -o /dev/null http://127.0.0.1:3000/ 2>/dev/null; then
  echo "⚠️  Ya hay un Prospector IA corriendo en el puerto 3000."
  xdg-open http://127.0.0.1:3000/ >/dev/null 2>&1 || true
  echo "    Abro el navegador. (Para apagarlo: Ctrl+C en su ventana.)"
  exit 0
fi

# ¿Node instalado?
if ! command -v node >/dev/null 2>&1; then
  echo "❌ Falta Node.js. Instalalo con:"
  echo "     sudo apt update && sudo apt install -y nodejs npm"
  echo
  read -rp "Enter para cerrar..." _ || true
  exit 1
fi

# Dependencias (solo la primera vez)
if [ ! -d node_modules ]; then
  echo "📦 Primera vez: instalando dependencias (1-2 min)..."
  if ! npm install --legacy-peer-deps --no-audit --no-fund; then
    echo "❌ Falló la instalación de dependencias."
    read -rp "Enter para cerrar..." _ || true
    exit 1
  fi
fi

# Claves de IA
if [ ! -f .env ] || ! grep -qE '^(GEMINI_API_KEY|OPENROUTER_API_KEY|NVIDIA_API_KEY)=.+' .env 2>/dev/null; then
  echo "💡 No hay claves de IA configuradas en .env (el motor funciona igual, solo sin IA)."
  echo "   Gemini gratis: https://aistudio.google.com/apikey"
  echo
fi

# Abrir el navegador cuando el servidor responda
(
  for _ in $(seq 1 60); do
    if curl -s -o /dev/null http://127.0.0.1:3000/ 2>/dev/null; then
      xdg-open http://127.0.0.1:3000/ >/dev/null 2>&1 || true
      break
    fi
    sleep 0.5
  done
) &

echo "🚀 Encendiendo... (dejá esta ventana abierta; para apagar: Ctrl+C)"
echo
npm run dev
