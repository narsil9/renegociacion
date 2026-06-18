#!/usr/bin/env bash
# Enciende / apaga / revisa el WORKER (daemon) de la automatización Superir.
# Portátil: corre en este Mac o en cualquier otra máquina con Node + el repo + .env.
#
# Uso:
#   bash scripts/sistema.sh start    → enciende el worker (deja el daemon corriendo)
#   bash scripts/sistema.sh stop     → lo apaga
#   bash scripts/sistema.sh status   → dice si está vivo + últimas líneas de log
#   bash scripts/sistema.sh logs     → sigue el log en vivo
set -euo pipefail

# Raíz del repo = carpeta padre de /scripts (funciona en cualquier ruta/máquina).
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
LOG="$ROOT/worker.log"
NAME="renegociacion-worker"
CMD="${1:-start}"

require() { command -v "$1" >/dev/null 2>&1 || { echo "❌ Falta '$1' en esta máquina."; exit 1; }; }

prepare() {
  require node; require npm
  [ -f .env ] || { echo "❌ Falta el archivo .env en $ROOT (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ANTHROPIC_API_KEY, HEADLESS=true)."; exit 1; }
  [ -d node_modules ] || { echo "📦 Instalando dependencias..."; npm install; }
  # Navegador de Playwright (idempotente; no falla si ya está).
  npx playwright install chromium >/dev/null 2>&1 || true
}

is_running() { pgrep -f "src/worker.ts" >/dev/null 2>&1; }

start() {
  prepare
  if is_running; then echo "✓ El worker YA está corriendo."; status; return 0; fi
  if command -v pm2 >/dev/null 2>&1; then
    # Modo servidor: pm2 reinicia el worker si crashea y lo levanta al bootear.
    pm2 start npm --name "$NAME" --time -- run worker
    pm2 save
    echo "✓ Worker encendido con pm2 ($NAME). Para arranque al boot (1 vez): pm2 startup"
  else
    # Sin pm2: background con nohup (sobrevive al cierre de la terminal).
    nohup npm run worker > "$LOG" 2>&1 &
    echo "✓ Worker encendido (PID $!). Log: $LOG"
  fi
}

stop() {
  if command -v pm2 >/dev/null 2>&1 && pm2 describe "$NAME" >/dev/null 2>&1; then
    pm2 delete "$NAME" || true
  fi
  pkill -f "src/worker.ts" 2>/dev/null || true
  sleep 1
  is_running && echo "⚠️ Aún hay un worker vivo." || echo "✓ Worker detenido."
}

status() {
  if is_running; then echo "🟢 Worker VIVO (PID $(pgrep -f 'src/worker.ts' | tr '\n' ' '))."; else echo "🔴 Worker apagado."; fi
  [ -f "$LOG" ] && { echo "— últimas líneas de $LOG —"; tail -8 "$LOG"; } || true
}

case "$CMD" in
  start) start ;;
  stop) stop ;;
  status) status ;;
  logs) [ -f "$LOG" ] && tail -f "$LOG" || { command -v pm2 >/dev/null 2>&1 && pm2 logs "$NAME"; } ;;
  *) echo "Uso: bash scripts/sistema.sh {start|stop|status|logs}"; exit 1 ;;
esac
