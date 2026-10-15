# NexiStore: despliegue en Hostinger (Node.js)

Este ZIP trae la tienda **ya compilada**. No hace falta compilar nada: Hostinger solo instala las
dependencias y arranca el servidor.

**Requisitos:** un plan de Hostinger con **aplicaciones Node.js** (Business, Cloud o VPS) y una base de datos **MySQL**.

---

## 1. Crea la base de datos

En **hPanel → Bases de datos → Administración (MySQL)**:

1. Crea una base de datos y un usuario con contraseña.
2. Anota el **nombre de la base**, el **usuario**, la **contraseña** y el **host** (normalmente `localhost`).

No necesitas importar nada: las tablas se crean solas la primera vez que arranca la app.

## 2. Sube la aplicación

En **hPanel → Sitios web → Agregar sitio web → Aplicación Node.js** (o *Node.js Apps*):

1. Elige **subir archivos** y selecciona `nexistore-hostinger.zip`.
2. Configuración de la app (los nombres exactos pueden variar un poco en el panel):
   - **Versión de Node.js:** 22 (o 20)
   - **Comando de instalación / build:** `npm install` (déjalo en el valor por defecto si ya instala dependencias)
   - **Archivo de entrada:** `dist/node/server/index.js` (o comando de inicio `npm start`)
3. Antes de desplegar, agrega las **variables de entorno** del paso 3.

## 3. Variables de entorno

Configúralas en la sección de variables de entorno de la app Node.js en hPanel. `.env.example` trae la lista completa comentada.

**Obligatorias**

| Variable | Valor |
|---|---|
| `NODE_ENV` | `production` |
| `APP_URL` | `https://tu-dominio.com` (sin barra final) |
| `TRUST_PROXY` | `true` |
| `DB_HOST` | `localhost` (o el host que indique hPanel) |
| `DB_PORT` | `3306` |
| `DB_USER` / `DB_PASSWORD` / `DB_NAME` | Los del paso 1 |
| `INVENTORY_ENCRYPTION_KEY` | Una llave de 64 caracteres hexadecimales (ver abajo). **Guárdala también fuera del servidor**: sin ella no se pueden leer las cuentas del inventario |
| `ADMIN_EMAIL` | Tu correo de administrador |
| `ADMIN_PASSWORD` | Una contraseña de 8+ caracteres con letras y números |

Para generar la llave puedes usar cualquier computador con Node.js:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

O usa un generador de "hex 32 bytes" de confianza.

> `ADMIN_EMAIL` y `ADMIN_PASSWORD` crean el **primer administrador** al arrancar, solo si todavía no hay ninguno. Después de iniciar sesión, borra `ADMIN_PASSWORD` de las variables.

**Opcionales** (sin ellas, el método correspondiente aparece como «pendiente de configuración»)

| Variable | Para qué |
|---|---|
| `SEED_DEMO=true` | Carga el catálogo de ejemplo si la base está vacía (útil para probar; quítala después) |
| `SMTP_HOST=smtp.hostinger.com`, `SMTP_PORT=465`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM` | Correos: recuperar contraseña y alertas |
| `WOMPI_PUBLIC_KEY`, `WOMPI_INTEGRITY_SECRET`, `WOMPI_EVENTS_SECRET` | Nequi, Bancolombia, PSE y tarjetas |
| `MP_ACCESS_TOKEN`, `MP_WEBHOOK_SECRET` | Mercado Pago |
| `ZENOBANK_API_KEY`, `ZENOBANK_WEBHOOK_SECRET`, `ZENOBANK_PRICE_CURRENCY=USD` | Criptomonedas |
| `MANUAL_PAYMENTS_ENABLED=true` | Pagos por transferencia confirmados por el admin |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Iniciar sesión con Google |

## 4. Despliega y comprueba

1. Despliega y abre `https://tu-dominio.com/api/health`: debe responder `{"ok":true}`.
2. Entra a `https://tu-dominio.com/ingresar` con `ADMIN_EMAIL` y `ADMIN_PASSWORD`, y después ve a `/admin`.
3. Activa el **SSL** del dominio en hPanel. La tienda debe servirse por HTTPS porque las cookies de sesión son seguras.

## 5. Configura las pasarelas (webhooks)

En el panel de cada proveedor registra estas URL:

| Pasarela | URL |
|---|---|
| Wompi (eventos) | `https://tu-dominio.com/api/payments/webhooks/wompi` |
| Mercado Pago (pagos) | `https://tu-dominio.com/api/payments/webhooks/mercadopago` |
| Zenobank (checkout.completed / expired / partially_paid) | `https://tu-dominio.com/api/payments/webhooks/zenobank` |

Si cobras con Zenobank en USD, define la tasa en **Admin → Configuración → Criptomonedas**.

## 6. Primeros pasos en el panel

- **Productos:** crea o edita tu catálogo. Para cuentas con entrega automática, elige «Entrega automática desde inventario» y carga las cuentas en **Inventario de cuentas**.
- **Configuración:** escribe el correo de soporte y las instrucciones de pago por transferencia, y ajusta la campaña de temporada.
- **Billetera:** recarga saldo manualmente a tus clientes cuando te paguen por fuera.

## Actualizar a una nueva versión

Sube el nuevo ZIP sobre la misma app y vuelve a desplegar. Las migraciones nuevas se aplican solas al arrancar y tus datos se conservan.

## Si algo falla

- **La app no arranca:** revisa los registros (logs) de la app en hPanel. «Variables de entorno inválidas» indica cuál falta o está mal escrita.
- **Error de base de datos:** verifica `DB_HOST`, `DB_USER`, `DB_PASSWORD` y `DB_NAME`, y que el usuario tenga permisos sobre la base.
- **No inicia sesión o el formulario «expira»:** confirma que `APP_URL` coincide exactamente con tu dominio (https) y que `TRUST_PROXY=true`.
- **«Inventario pendiente de configuración»:** falta `INVENTORY_ENCRYPTION_KEY`.
