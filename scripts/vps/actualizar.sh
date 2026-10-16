#!/usr/bin/env bash
#
# NexiStore — actualizar a una versión nueva en el VPS.
# Uso: descomprime el ZIP nuevo en una carpeta y, desde ella, ejecuta:
#   sudo bash actualizar.sh
#
# Hace una copia de seguridad de la base de datos, reemplaza los archivos (conserva .env),
# instala dependencias y reinicia. Las migraciones de la base de datos se aplican solas al arrancar.

set -Eeuo pipefail

APP_DIR=/opt/nexistore
APP_USER=nexistore
APP_PORT=3000
SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

c_ok=$'\e[32m'; c_err=$'\e[31m'; c_b=$'\e[1m'; c_0=$'\e[0m'
ok() { echo "  ${c_ok}✔${c_0} $*"; }
fail() { echo "${c_err}✖ $*${c_0}" >&2; exit 1; }
trap 'fail "La actualización se detuvo en la línea $LINENO."' ERR

[[ $EUID -eq 0 ]] || fail "Ejecuta como root: sudo bash actualizar.sh"
[[ -f "$APP_DIR/.env" ]] || fail "No hay una instalación en $APP_DIR. Usa primero instalar.sh."
[[ -f "$SRC_DIR/dist/node/server/index.js" ]] || fail "Ejecuta el script desde la carpeta del ZIP nuevo."
[[ "$SRC_DIR" != "$APP_DIR" ]] || fail "Descomprime el ZIP nuevo en otra carpeta (no en $APP_DIR)."

echo "${c_b}NexiStore — actualización${c_0}"
if command -v nexistore-backup >/dev/null 2>&1; then
  nexistore-backup >/dev/null && ok "Copia de seguridad hecha antes de actualizar"
fi
rsync -a --delete --exclude '.env' --exclude 'node_modules' "$SRC_DIR"/ "$APP_DIR"/
cd "$APP_DIR"
npm ci --omit=dev --no-audit --no-fund --loglevel=error
chown -R "$APP_USER":"$APP_USER" "$APP_DIR"
ok "Archivos y dependencias actualizados"

systemctl restart nexistore
for _ in $(seq 1 60); do
  curl -fsS "http://127.0.0.1:$APP_PORT/api/health" >/dev/null 2>&1 && break
  sleep 1
done
curl -fsS "http://127.0.0.1:$APP_PORT/api/health" >/dev/null 2>&1 || {
  journalctl -u nexistore -n 40 --no-pager || true
  fail "La tienda no respondió después de actualizar. Revisa los registros de arriba."
}
ok "Tienda funcionando con la versión nueva"
echo "  Recarga el navegador con Ctrl + Shift + R para ver los cambios."
