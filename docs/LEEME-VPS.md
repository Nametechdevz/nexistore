# NexiStore en un VPS (Linode, DigitalOcean, Vultr…)

Instalación automática con un solo comando. El instalador deja todo listo:

- Node.js 22, MariaDB, Nginx y el firewall.
- El servicio de la tienda, que arranca solo y se reinicia si falla.
- Tu dominio con HTTPS gratis (Let's Encrypt, se renueva solo).
- Copias de seguridad diarias de la base de datos.

## Qué necesitas

| | |
|---|---|
| **VPS** | Linode con **Ubuntu 24.04 LTS** (también sirve 22.04 o Debian 12). Plan mínimo **Nanode 1 GB**; recomendado **Linode 2 GB** si vas a tener muchas visitas. |
| **Dominio** | Un dominio o subdominio (ej. `tienda.com` o `shop.tienda.com`) donde puedas editar el DNS. |
| **Acceso** | La IP del servidor y la contraseña de root (o tu llave SSH). |
| **El ZIP** | `nexistore-vps.zip` (o el de Hostinger: es el mismo contenido). |

## Paso 1 · Crear el VPS en Linode

1. En cloud.linode.com → **Create → Linode**.
2. Imagen: **Ubuntu 24.04 LTS**. Región: la más cercana a tus clientes (para Colombia: **Miami** o **Atlanta**).
3. Plan: **Shared CPU → Nanode 1 GB** o **Linode 2 GB**.
4. Escribe una **contraseña de root** segura y crea el servidor.
5. Copia la **IPv4** que te muestra (ej. `172.233.10.20`).

## Paso 2 · Apuntar el dominio

En el panel donde compraste el dominio (o en el DNS de Linode), crea un registro:

| Tipo | Nombre | Valor |
|---|---|---|
| A | `@` (o `shop` si es un subdominio) | la IPv4 del VPS |
| A *(opcional)* | `www` | la IPv4 del VPS |

Espera de 5 a 30 minutos a que se propague.

## Paso 3 · Subir el ZIP

Desde tu computador. En Windows usa **PowerShell**; en Mac o Linux, la Terminal:

```bash
scp nexistore-vps.zip root@TU_IP:/root/
```

> También puedes usar **WinSCP** o **FileZilla** (protocolo SFTP, usuario `root`).

## Paso 4 · Instalar

Conéctate al servidor:

```bash
ssh root@TU_IP
```

Descomprime el ZIP y ejecuta el instalador:

```bash
apt-get update && apt-get install -y unzip
unzip -o nexistore-vps.zip -d nexistore-instalador
cd nexistore-instalador
sudo bash instalar.sh
```

Te preguntará el **dominio**, el **correo y la contraseña del administrador** y si quieres el **catálogo de ejemplo**. En unos 3 a 5 minutos verás:

```
✔ NexiStore quedó instalada.
  Tienda:   https://tu-dominio.com
  Panel:    https://tu-dominio.com/admin
```

Entra a `/admin` con tu correo y contraseña y configura **pagos, correo, cuentas de transferencia y apariencia** en *Configuración*.

> **Seguridad:** después de entrar la primera vez, borra las líneas `ADMIN_EMAIL` y `ADMIN_PASSWORD` del archivo `/opt/nexistore/.env` (`sudo nano /opt/nexistore/.env`) y ejecuta `sudo systemctl restart nexistore`.

## Actualizar a una versión nueva

Sube el ZIP nuevo y, en el servidor:

```bash
unzip -o nexistore-vps.zip -d nexistore-nuevo
cd nexistore-nuevo
sudo bash actualizar.sh
```

El script hace primero una copia de seguridad. Conserva tu configuración y tus datos, y aplica solo los cambios de la base de datos.

## Comandos útiles

| Para | Comando |
|---|---|
| Ver si está funcionando | `sudo systemctl status nexistore` |
| Ver los registros en vivo | `sudo journalctl -u nexistore -f` |
| Reiniciar la tienda | `sudo systemctl restart nexistore` |
| Hacer una copia ahora | `sudo nexistore-backup` |
| Ver las copias | `ls /var/backups/nexistore` |
| Restaurar una copia | `gunzip -c /var/backups/nexistore/ARCHIVO.sql.gz \| sudo mysql nexistore` |

**Importante:** las imágenes, los pedidos y la llave que cifra las cuentas del inventario están en la base de datos. Descarga de vez en cuando una copia a tu computador:

```bash
scp root@TU_IP:/var/backups/nexistore/*.sql.gz .
```

También puedes activar **Backups** en Linode (copia de todo el servidor, con costo adicional).

## Si algo falla

- **«El dominio todavía no apunta a este servidor»:** el DNS aún no se propagó. Espera y ejecuta `sudo certbot --nginx -d tu-dominio.com --redirect`.
- **No puedo iniciar sesión:** la tienda debe abrirse con **https://**. Sin HTTPS, las cookies de sesión seguras no funcionan.
- **La tienda no carga:** revisa `sudo journalctl -u nexistore -n 50`.
- **Correos:** configura el SMTP en *Configuración*. Muchos proveedores de VPS bloquean el puerto 25, pero el 465 y el 587 de tu proveedor de correo funcionan.
