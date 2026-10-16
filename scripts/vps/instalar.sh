#!/usr/bin/env bash
#
# NexiStore — instalador para VPS (Linode, DigitalOcean, Vultr, AWS Lightsail…)
# Sistemas compatibles: Ubuntu 22.04 / 24.04 LTS y Debian 12.
#
# Uso (como root o con sudo), desde la carpeta donde descomprimiste el ZIP:
#   sudo bash instalar.sh
#
# También puedes pasar los datos sin preguntas:
#   sudo DOMINIO=tienda.com ADMIN_EMAIL=tu@correo.com ADMIN_PASSWORD='Clave123' bash instalar.sh
#
# Qué hace:
#   1. Instala Node.js 22, MariaDB, Nginx, Certbot y el firewall (UFW).
#   2. Crea la base de datos con una contraseña aleatoria.
#   3. Copia la tienda a /opt/nexistore y la deja como servicio (arranca sola y se reinicia si falla).
#   4. Configura Nginx con tu dominio y el certificado SSL gratis de Let's Encrypt (HTTPS).
#   5. Activa copias de seguridad diarias de la base de datos (se guardan 14 días).
# Se puede volver a ejecutar sin perder datos.

set -Eeuo pipefail

APP_DIR=/opt/nexistore
APP_USER=nexistore
APP_PORT=3000
DB_NAME=nexistore
DB_USER=nexistore
BACKUP_DIR=/var/backups/nexistore
SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

c_ok=$'\e[32m'; c_warn=$'\e[33m'; c_err=$'\e[31m'; c_b=$'\e[1m'; c_0=$'\e[0m'
step() { echo; echo "${c_b}▶ $*${c_0}"; }
ok() { echo "  ${c_ok}✔${c_0} $*"; }
warn() { echo "  ${c_warn}!${c_0} $*"; }
fail() { echo "${c_err}✖ $*${c_0}" >&2; exit 1; }
trap 'fail "La instalación se detuvo en la línea $LINENO. Revisa el mensaje de arriba."' ERR

# ---------------------------------------------------------------- comprobaciones
[[ $EUID -eq 0 ]] || fail "Ejecuta el instalador como root: sudo bash instalar.sh"
[[ -f "$SRC_DIR/dist/node/server/index.js" && -f "$SRC_DIR/package.json" ]] \
  || fail "No encuentro la tienda. Ejecuta el script desde la carpeta donde descomprimiste el ZIP."
# shellcheck disable=SC1091
. /etc/os-release
case "${ID:-}" in
  ubuntu | debian) ;;
  *) fail "Sistema no compatible (${PRETTY_NAME:-desconocido}). Usa Ubuntu 22.04/24.04 o Debian 12." ;;
esac

echo "${c_b}NexiStore — instalación en VPS${c_0} (${PRETTY_NAME})"

# ---------------------------------------------------------------- datos
REINSTALL=0
[[ -f "$APP_DIR/.env" ]] && REINSTALL=1

ask() { # ask VAR "Pregunta" [valor por defecto]
  local var=$1 q=$2 def=${3:-} val=${!1:-}
  while [[ -z "$val" ]]; do
    read -rp "  $q${def:+ [$def]}: " val
    val=${val:-$def}
  done
  printf -v "$var" '%s' "$val"
}

DOMINIO=${DOMINIO:-}
ask DOMINIO "Dominio de la tienda (sin https, ej. tienda.com o shop.tienda.com)"
DOMINIO=${DOMINIO#http://}; DOMINIO=${DOMINIO#https://}; DOMINIO=${DOMINIO%%/*}; DOMINIO=${DOMINIO,,}
[[ "$DOMINIO" =~ ^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$ ]] || fail "Dominio no válido: $DOMINIO"

if [[ $REINSTALL -eq 0 ]]; then
  ADMIN_EMAIL=${ADMIN_EMAIL:-}
  ask ADMIN_EMAIL "Correo del administrador"
  [[ "$ADMIN_EMAIL" =~ ^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$ ]] || fail "Correo no válido."
  ADMIN_PASSWORD=${ADMIN_PASSWORD:-}
  while [[ -z "$ADMIN_PASSWORD" ]]; do
    read -rsp "  Contraseña del administrador (8+ caracteres, letras y números): " p1; echo
    read -rsp "  Repite la contraseña: " p2; echo
    [[ "$p1" == "$p2" ]] && ADMIN_PASSWORD=$p1 || warn "No coinciden, inténtalo de nuevo."
  done
  [[ ${#ADMIN_PASSWORD} -ge 8 && "$ADMIN_PASSWORD" =~ [A-Za-z] && "$ADMIN_PASSWORD" =~ [0-9] ]] \
    || fail "La contraseña debe tener al menos 8 caracteres, con letras y números."
  [[ "$ADMIN_PASSWORD" != *"'"* ]] || fail "La contraseña no puede contener comillas simples (')."
  DEMO=${DEMO:-}
  ask DEMO "¿Cargar el catálogo de ejemplo? (s/n)" "n"
else
  ok "Instalación existente encontrada: se conservan la base de datos y la configuración."
fi
SSL_EMAIL=${SSL_EMAIL:-${ADMIN_EMAIL:-}}

export DEBIAN_FRONTEND=noninteractive

# ---------------------------------------------------------------- 1. paquetes
step "1/7 Instalando paquetes del sistema"
apt-get update -qq
apt-get install -y -qq ca-certificates curl gnupg unzip rsync openssl nginx mariadb-server ufw certbot python3-certbot-nginx >/dev/null
ok "Nginx, MariaDB, Certbot y UFW instalados"

need_node=1
if command -v node >/dev/null 2>&1; then
  major=$(node -p 'process.versions.node.split(".")[0]')
  [[ $major -ge 20 ]] && need_node=0
fi
if [[ $need_node -eq 1 ]]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash - >/dev/null
  apt-get install -y -qq nodejs >/dev/null
fi
ok "Node.js $(node -v)"

# Memoria de intercambio en planes pequeños (evita cierres por falta de RAM).
mem_mb=$(awk '/MemTotal/ {print int($2/1024)}' /proc/meminfo)
if [[ $mem_mb -lt 1900 ]] && ! swapon --show | grep -q .; then
  fallocate -l 1G /swapfile && chmod 600 /swapfile && mkswap /swapfile >/dev/null && swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >>/etc/fstab
  ok "Memoria de intercambio de 1 GB creada (el servidor tiene ${mem_mb} MB de RAM)"
fi

# ---------------------------------------------------------------- 2. archivos
step "2/7 Copiando la tienda a $APP_DIR"
id -u "$APP_USER" >/dev/null 2>&1 || useradd --system --home "$APP_DIR" --shell /usr/sbin/nologin "$APP_USER"
mkdir -p "$APP_DIR"
if [[ "$SRC_DIR" != "$APP_DIR" ]]; then
  rsync -a --delete --exclude '.env' --exclude 'node_modules' "$SRC_DIR"/ "$APP_DIR"/
fi
cd "$APP_DIR"
npm ci --omit=dev --no-audit --no-fund --loglevel=error
chown -R "$APP_USER":"$APP_USER" "$APP_DIR"
ok "Archivos y dependencias listos"

# ---------------------------------------------------------------- 3. base de datos
step "3/7 Preparando la base de datos"
systemctl enable --now mariadb >/dev/null 2>&1
if [[ $REINSTALL -eq 1 ]]; then
  DB_PASS=$(grep -E "^DB_PASSWORD=" "$APP_DIR/.env" | head -1 | cut -d= -f2- | sed -e "s/^'//" -e "s/'$//")
else
  DB_PASS=$(openssl rand -hex 24)
fi
mysql <<SQL
CREATE DATABASE IF NOT EXISTS \`$DB_NAME\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER IF NOT EXISTS '$DB_USER'@'localhost' IDENTIFIED BY '$DB_PASS';
CREATE USER IF NOT EXISTS '$DB_USER'@'127.0.0.1' IDENTIFIED BY '$DB_PASS';
ALTER USER '$DB_USER'@'localhost' IDENTIFIED BY '$DB_PASS';
ALTER USER '$DB_USER'@'127.0.0.1' IDENTIFIED BY '$DB_PASS';
GRANT ALL PRIVILEGES ON \`$DB_NAME\`.* TO '$DB_USER'@'localhost';
GRANT ALL PRIVILEGES ON \`$DB_NAME\`.* TO '$DB_USER'@'127.0.0.1';
FLUSH PRIVILEGES;
SQL
ok "Base de datos «$DB_NAME» lista (usuario «$DB_USER», contraseña aleatoria)"

# ---------------------------------------------------------------- 4. configuración y servicio
step "4/7 Configurando el servicio"
if [[ $REINSTALL -eq 0 ]]; then
  umask 077
  cat >"$APP_DIR/.env" <<ENV
# NexiStore — generado por instalar.sh el $(date -u +%F). No lo compartas.
NODE_ENV=production
PORT=$APP_PORT
HOST=127.0.0.1
DB_HOST=127.0.0.1
DB_PORT=3306
DB_USER=$DB_USER
DB_PASSWORD='$DB_PASS'
DB_NAME=$DB_NAME
# Crea el primer administrador al arrancar. Después de entrar, borra estas dos líneas.
ADMIN_EMAIL='$ADMIN_EMAIL'
ADMIN_PASSWORD='$ADMIN_PASSWORD'
ENV
  [[ "${DEMO,,}" == s* ]] && echo "SEED_DEMO=true" >>"$APP_DIR/.env"
fi
chown "$APP_USER":"$APP_USER" "$APP_DIR/.env"
chmod 600 "$APP_DIR/.env"

cat >/etc/systemd/system/nexistore.service <<UNIT
[Unit]
Description=NexiStore (tienda)
After=network.target mariadb.service
Wants=mariadb.service

[Service]
Type=simple
User=$APP_USER
Group=$APP_USER
WorkingDirectory=$APP_DIR
ExecStart=$(command -v node) dist/node/server/index.js
Restart=always
RestartSec=3
Environment=NODE_ENV=production
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full
ProtectHome=true

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable nexistore >/dev/null 2>&1
systemctl restart nexistore

for _ in $(seq 1 60); do
  curl -fsS "http://127.0.0.1:$APP_PORT/api/health" >/dev/null 2>&1 && break
  sleep 1
done
if ! curl -fsS "http://127.0.0.1:$APP_PORT/api/health" >/dev/null 2>&1; then
  journalctl -u nexistore -n 40 --no-pager || true
  fail "La tienda no respondió. Arriba están los últimos registros del servicio."
fi
ok "La tienda está funcionando (servicio «nexistore»)"

# ---------------------------------------------------------------- 5. nginx
step "5/7 Configurando Nginx para $DOMINIO"
SERVER_IPS=$(hostname -I 2>/dev/null || true)
resolves_here() { # ¿el nombre apunta a este servidor?
  local ips
  ips=$(getent ahostsv4 "$1" 2>/dev/null | awk '{print $1}' | sort -u)
  [[ -n "$ips" ]] || return 1
  for ip in $ips; do [[ " $SERVER_IPS " == *" $ip "* ]] && return 0; done
  return 1
}
NAMES="$DOMINIO"
if [[ "$DOMINIO" != www.* ]] && resolves_here "www.$DOMINIO"; then NAMES="$DOMINIO www.$DOMINIO"; fi

# IPv6 solo si el servidor lo tiene (algunos VPS vienen sin IPv6).
LISTEN6=""
[[ -s /proc/net/if_inet6 ]] && LISTEN6="listen [::]:80;"

cat >/etc/nginx/sites-available/nexistore <<NGINX
# NexiStore — generado por instalar.sh
server {
    listen 80;
    $LISTEN6
    server_name $NAMES;

    client_max_body_size 8m;
    gzip on;
    gzip_types text/plain text/css application/javascript application/json image/svg+xml;

    location / {
        proxy_pass http://127.0.0.1:$APP_PORT;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_read_timeout 60s;
    }
}
NGINX
ln -sf /etc/nginx/sites-available/nexistore /etc/nginx/sites-enabled/nexistore
rm -f /etc/nginx/sites-enabled/default
nginx -t >/dev/null 2>&1 || { nginx -t; fail "La configuración de Nginx tiene un error."; }
systemctl enable --now nginx >/dev/null 2>&1
systemctl reload nginx
ok "Nginx atiende $NAMES"

# ---------------------------------------------------------------- 6. firewall
step "6/7 Activando el firewall"
ufw allow OpenSSH >/dev/null
ufw allow 'Nginx Full' >/dev/null
ufw --force enable >/dev/null
ok "Solo están abiertos SSH (22), HTTP (80) y HTTPS (443)"

# ---------------------------------------------------------------- 7. SSL y copias de seguridad
step "7/7 Certificado SSL y copias de seguridad"
SSL_OK=0
if resolves_here "$DOMINIO"; then
  domains=()
  for n in $NAMES; do domains+=(-d "$n"); done
  if certbot --nginx "${domains[@]}" --non-interactive --agree-tos -m "${SSL_EMAIL:-admin@$DOMINIO}" --redirect >/dev/null 2>&1; then
    SSL_OK=1
    ok "HTTPS activo (se renueva solo)"
  else
    warn "Certbot no pudo emitir el certificado. Revisa el DNS y ejecuta: sudo certbot --nginx -d $DOMINIO"
  fi
else
  warn "El dominio $DOMINIO todavía no apunta a este servidor (IP: ${SERVER_IPS%% *})."
  warn "Crea un registro A en tu DNS hacia esa IP, espera unos minutos y ejecuta: sudo certbot --nginx -d $DOMINIO --redirect"
fi

mkdir -p "$BACKUP_DIR" && chmod 700 "$BACKUP_DIR"
cat >/usr/local/bin/nexistore-backup <<BACKUP
#!/usr/bin/env bash
# Copia de la base de datos de NexiStore (productos, pedidos, imágenes y la llave del inventario).
set -euo pipefail
f="$BACKUP_DIR/nexistore-\$(date +%F-%H%M).sql.gz"
mysqldump --single-transaction --routines "$DB_NAME" | gzip >"\$f"
chmod 600 "\$f"
find "$BACKUP_DIR" -name 'nexistore-*.sql.gz' -mtime +14 -delete
echo "Copia guardada: \$f"
BACKUP
chmod 700 /usr/local/bin/nexistore-backup
echo "17 3 * * * root /usr/local/bin/nexistore-backup >/dev/null 2>&1" >/etc/cron.d/nexistore-backup
/usr/local/bin/nexistore-backup >/dev/null
ok "Copia diaria a las 3:17 en $BACKUP_DIR (se guardan 14 días)"

# ---------------------------------------------------------------- resumen
URL="http://$DOMINIO"; [[ $SSL_OK -eq 1 ]] && URL="https://$DOMINIO"
echo
echo "${c_ok}${c_b}✔ NexiStore quedó instalada.${c_0}"
echo
echo "  Tienda:   $URL"
echo "  Panel:    $URL/admin"
[[ $REINSTALL -eq 0 ]] && echo "  Admin:    $ADMIN_EMAIL"
echo
echo "  Siguientes pasos:"
[[ $SSL_OK -eq 0 ]] && echo "   • Activa HTTPS (paso 7). Sin HTTPS el inicio de sesión no funciona."
echo "   • Entra al panel → Configuración y configura pagos, correo y la apariencia."
[[ $REINSTALL -eq 0 ]] && echo "   • Por seguridad, borra ADMIN_EMAIL y ADMIN_PASSWORD de $APP_DIR/.env y ejecuta: sudo systemctl restart nexistore"
echo
echo "  Comandos útiles:"
echo "   sudo systemctl status nexistore      (estado)"
echo "   sudo journalctl -u nexistore -f      (registros en vivo)"
echo "   sudo nexistore-backup                (copia de seguridad ahora)"
echo "   sudo bash actualizar.sh              (instalar una versión nueva, desde la carpeta del ZIP nuevo)"
