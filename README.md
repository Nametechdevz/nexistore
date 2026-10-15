# NexiStore

Tienda y marketplace de productos digitales: catálogo, búsqueda y filtros, carrito persistente, checkout con pasarelas de pago reales, seguimiento de pedidos, panel de usuario y panel administrativo.

- **Frontend:** React 19 + Vite + TypeScript, CSS propio con tokens de diseño (`client/src/styles/tokens.css`).
- **Backend:** Node.js + Express 5 + TypeScript.
- **Base de datos:** MySQL 8 / MariaDB 10.6+ (la que ofrece Hostinger), con migraciones SQL versionadas en `db/migrations`.
- **Validación:** esquemas zod compartidos entre cliente y servidor (`shared/schemas.ts`).

> Los productos de ejemplo son **ficticios** y usan arte propio, sin logotipos de terceros. Reemplázalos desde el panel por tu catálogo real: licencias, claves o tarjetas de distribuidores autorizados.

---

## Estructura

```
client/            Frontend (Vite)
  src/styles/      tokens.css (colores, tipografía, espacios, radios, sombras) y componentes
  src/components/  UI reutilizable (Layout, ProductCard, AreaChart, formularios…)
  src/pages/       Tienda, checkout, auth, cuenta/ y admin/ (el admin se carga bajo demanda)
server/            API Express
  routes/          auth, catálogo, tienda (carrito/pedidos), cuenta, admin, webhooks de pago
  services/        lógica de negocio: pedidos, inventario, cupones, catálogo, correo, ajustes
  payments/        adaptadores Mercado Pago y Wompi + transferencia manual
  middleware/      sesión, CSRF y control de roles
shared/            Tipos, constantes (estados de pedido) y validación compartida
db/migrations/     Esquema versionado (001_init.sql…)
tests/             Pruebas unitarias y de API (vitest) y extremo a extremo (Playwright)
design/            Maqueta de referencia del sistema de diseño
```

## Instalación local

Requisitos: Node.js 20.12 o superior y MySQL/MariaDB.

```bash
npm install
cp .env.example .env          # ajusta DB_*, APP_URL=http://localhost:5173, NODE_ENV=development
npm run db:migrate            # crea las tablas
npm run db:seed               # datos de ejemplo (solo si no hay categorías)
npm run admin:create -- admin@tu-dominio.com "Tu Nombre" 'ClaveSegura123'
npm run dev                   # API en :3000 y web en http://localhost:5173
```

### Pruebas

```bash
# Pruebas unitarias y de API: usan una base de datos aparte (por defecto nexistore_test)
TEST_DB_USER=... TEST_DB_PASSWORD=... TEST_DB_NAME=nexistore_test npm test

# Prueba de extremo a extremo + capturas (390 px, 820 px y 1366 px), con la app compilada y corriendo:
npm run build && npm start &
BASE_URL=http://localhost:3000 ADMIN_EMAIL=... ADMIN_PASSWORD=... npm run e2e
# Billetera, entrega automática, cuenta caída, soporte e inventario:
BASE_URL=http://localhost:3000 ADMIN_EMAIL=... ADMIN_PASSWORD=... node tests/e2e/features.mjs
```

`npm run typecheck` valida los tipos del frontend y del backend.

## Despliegue en Hostinger (Node.js + MySQL)

Sirve para los planes de Hostinger con aplicaciones **Node.js** (Business o Cloud).

1. **Base de datos:** en hPanel → *Bases de datos → MySQL*, crea una base de datos y un usuario. Anota el host (normalmente `localhost`), el nombre, el usuario y la contraseña.
2. **Aplicación Node.js:** en hPanel → *Sitios web → Agregar sitio → Aplicación Node.js*, conecta el repositorio de GitHub o sube el código.
   - Versión de Node: **20 o 22**.
   - Comando de build: `npm run build`
   - Comando de inicio / archivo de entrada: `npm start` (equivale a `node dist/node/server/index.js`)
3. **Variables de entorno:** cópialas de `.env.example` en el panel de la app. Como mínimo:
   - `NODE_ENV=production`, `APP_URL=https://tu-dominio.com` y `TRUST_PROXY=true`
   - `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD` y `DB_NAME`
   - Correo: `SMTP_HOST=smtp.hostinger.com`, `SMTP_PORT=465`, `SMTP_USER` y `SMTP_PASSWORD` (un buzón de Hostinger)
   - `INVENTORY_ENCRYPTION_KEY` (obligatoria para el inventario de cuentas; guárdala también fuera del servidor)
4. **Primer arranque:** el servidor aplica las migraciones pendientes al iniciar (`AUTO_MIGRATE=false` lo desactiva). Para crear el administrador y, si quieres, los datos de ejemplo, usa la terminal SSH del plan:
   ```bash
   npm run db:seed
   npm run admin:create -- tu@correo.com "Tu Nombre" 'ClaveSegura123'
   ```
5. **Dominio y SSL:** activa el SSL del dominio. Las cookies de sesión se marcan `Secure` en producción, así que la tienda debe servirse por HTTPS.

## Billetera

Cada cliente tiene un saldo en COP con historial completo (recargas, compras, reembolsos y ajustes).

- **Recargar:** con Wompi, Mercado Pago, Binance Pay o transferencia. Las recargas por pasarela se acreditan solas con la confirmación verificada del proveedor. Las de transferencia las confirma un administrador en *Admin → Billetera*.
- **Pagar con saldo:** el pedido queda pagado al instante. El débito y la confirmación ocurren en la misma transacción, con bloqueo de fila, así que el saldo nunca queda negativo.
- **Reembolsos:**
  - Desde un pedido: cambia el estado a *Reembolsado* y marca «Reembolsar a la billetera».
  - Desde un reporte de cuenta caída: el monto sugerido es proporcional a los días de servicio restantes.
- **Ajustes manuales:** desde *Admin → Clientes → Billetera*, con motivo obligatorio. Quedan auditados con el administrador que los hizo.

## Inventario de cuentas y entrega automática

En el producto, elige **Entrega: Automática desde inventario**, la **duración del servicio (días)** y el umbral de **alerta de poco stock**.

- **Carga:** en *Admin → Inventario de cuentas → Agregar cuentas*, una por línea, con el formato `credenciales | etiqueta | AAAA-MM-DD`. Las credenciales se guardan **cifradas** con `INVENTORY_ENCRYPTION_KEY`.
- **Ciclo:** disponible → **reservada** (al crear el pedido) → **vendida** (al confirmarse el pago; el pedido pasa a *Completado* solo). Termina en **vencida** o **caída**. Si el pedido se cancela, la cuenta vuelve a disponible.
- **Stock:** es siempre el número de cuentas disponibles.
- **Resumen por producto:** disponibles, vendidas, por vencer y caídas. Filtros por estado, por vencimiento en el proveedor y por fin del servicio del cliente.
- **Cuenta caída:** el administrador la marca como caída y elige *reemplazar automáticamente*. El cliente recibe otra cuenta (conserva la fecha de fin de su servicio), ve la novedad en su pedido y recibe una notificación. Si no hay cuentas disponibles, se abre un caso de soporte para el cliente.

## Soporte en la tienda

- **Conversación:** cada solicitud es un chat entre cliente y administrador, con estados abierta, respondida y cerrada. Se actualiza sola.
- **Reportar falla:** desde *Mis pedidos → Ver detalle*, el cliente reporta la cuenta que dejó de funcionar. Se crea un caso vinculado a esa cuenta y se alerta al administrador.
- **Resolver:** desde el caso, en un clic, se **reemplaza** la cuenta o se **reembolsa a la billetera**. El pedido, el inventario y la billetera se actualizan y el cliente recibe la respuesta en el chat.

## Alertas y notificaciones

Hay una campana en la tienda y otra en el panel. Las alertas importantes también se envían por correo si SMTP está configurado. La revisión corre cada hora (y con *Revisar alertas ahora* en Inventario):

| Alerta | Para | Cuándo |
|---|---|---|
| Poco inventario | Admin (+ correo) | Stock ≤ umbral del producto. También tras cada venta |
| Cuenta por vencer en el proveedor | Admin | 7 días antes. Urgente (+ correo) si vence antes que el servicio del cliente |
| Servicio por terminar | Cliente (+ correo) | 7 días y 1 día antes |
| Vencidas | — | Se marcan solas y salen del stock |
| Cuenta caída / reemplazada / reembolsos / respuestas de soporte | Cliente o admin | Al ocurrir |

## Pagos

Ningún pago se simula. Un pedido pasa a **Pagado** solo de dos formas:

- **Pasarela:** el servidor recibe una notificación con firma verificada o consulta directamente la API del proveedor, y comprueba que el **monto y la moneda coincidan exactamente** con el pedido. Los eventos son idempotentes.
- **Transferencia manual:** un administrador confirma haber recibido el dinero. El panel no permite marcar como pagado manualmente un pedido de pasarela.

Mientras falten credenciales, el método aparece como **«Pendiente de configuración»** y no se puede seleccionar.

| Método | Variables | URL de notificación (webhook) |
|---|---|---|
| Mercado Pago (Checkout Pro) | `MP_ACCESS_TOKEN`, `MP_WEBHOOK_SECRET` | `{APP_URL}/api/payments/webhooks/mercadopago` (evento *Pagos*) |
| Wompi (Nequi, Bancolombia, PSE, tarjetas) | `WOMPI_PUBLIC_KEY`, `WOMPI_INTEGRITY_SECRET`, `WOMPI_EVENTS_SECRET` | `{APP_URL}/api/payments/webhooks/wompi` |
| Transferencia (Nequi/Daviplata/Bancolombia) | `MANUAL_PAYMENTS_ENABLED=true` | Confirmación manual en el panel |
| Binance Pay (cripto, USDT) | `BINANCE_PAY_API_KEY`, `BINANCE_PAY_SECRET_KEY` + tasa COP/USDT en *Configuración* | `{APP_URL}/api/payments/webhooks/binance` |
| Billetera NexiStore | — | Interno: se descuenta del saldo |
| PayPal | — | **No integrado**: se muestra como «No disponible» |

**Binance Pay** no cobra en pesos. Cada pedido o recarga se cotiza en USDT con la tasa del panel, redondeando hacia arriba a 2 decimales, y la cotización se guarda. El pago solo se confirma si Binance reporta exactamente ese monto en USDT. La firma del webhook (RSA) se verifica con el certificado público de Binance y el estado se vuelve a consultar en su API.

Prueba primero con llaves de *sandbox*: las llaves `pub_test_` de Wompi usan su entorno de pruebas automáticamente. Al volver de la pasarela, la página de confirmación consulta el estado al proveedor desde el servidor, así que el pedido se confirma aunque el webhook tarde.

Los pedidos sin pagar se cancelan automáticamente a las 48 horas y liberan el inventario reservado.

## Seguridad

- **Inyección SQL:** todas las consultas usan parámetros, la búsqueda escapa `%` y `_`, y `multipleStatements` está desactivado.
- **XSS:** React escapa todo el contenido, el blog se renderiza como texto y hay una política CSP estricta con Helmet.
- **CSRF:** cookie y cabecera de doble envío en cada mutación, verificación de `Origin` y cookies `SameSite=Lax`.
- **Credenciales del inventario:** cifradas en reposo (AES-256-GCM); solo se muestran al cliente con el pedido completado y al administrador en el detalle de la cuenta.
- **Sesiones:** token aleatorio en cookie `httpOnly`; en la base de datos solo se guarda su hash SHA-256. Las contraseñas usan scrypt con sal.
- **Acceso:** el rol se comprueba en el servidor (`requireAuth` y `requireAdmin`) y cada cliente solo ve sus propios pedidos.
- **Abuso:** límite de intentos en login, registro y recuperación. La recuperación no revela si un correo existe y sus enlaces caducan en 1 hora y son de un solo uso.
- **CSV:** la exportación neutraliza fórmulas (inyección CSV).
- **Secretos:** solo en variables de entorno. `.env` está en `.gitignore`.

## Inicio de sesión con Google (opcional)

Crea credenciales OAuth en Google Cloud con la URI de redirección `{APP_URL}/api/auth/google/callback` y define `GOOGLE_CLIENT_ID` y `GOOGLE_CLIENT_SECRET`. Sin ellas, el botón aparece deshabilitado con el aviso «pendiente de configuración».

## Pendiente antes de vender

- Reemplazar los productos de ejemplo por el catálogo real.
- Sustituir los textos de **Términos** y **Privacidad** por versiones revisadas legalmente (Ley 1480 de 2011 y Ley 1581 de 2012).
- Configurar las credenciales de la pasarela y hacer una compra real de bajo valor en producción.
