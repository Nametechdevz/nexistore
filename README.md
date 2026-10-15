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
cp .env.example .env          # ajusta DB_* y añade NODE_ENV=development
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
3. **Variables de entorno:** solo la base de datos y el primer administrador: `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`, `ADMIN_EMAIL` y `ADMIN_PASSWORD` (opcional `SEED_DEMO=true` para el catálogo de ejemplo).
4. **Primer arranque:** el servidor aplica las migraciones, genera la llave de cifrado del inventario (se guarda en la base de datos) y crea el administrador si no existe ninguno.
5. **Panel:** en *Admin → Configuración → «Pagos, correo y acceso»* se configuran Wompi, Mercado Pago, Zenobank, transferencias, el correo SMTP, Google y la URL de la tienda. Los cambios se aplican al instante y los secretos se muestran enmascarados.
6. **Dominio y SSL:** activa el SSL del dominio. Las cookies de sesión se marcan `Secure` en producción, así que la tienda debe servirse por HTTPS.

## Billetera

Cada cliente tiene un saldo en COP con historial completo (recargas, compras, reembolsos y ajustes).

- **Recargar:** con Wompi, Mercado Pago, Zenobank (cripto) o transferencia. Las recargas por pasarela se acreditan solas con la confirmación verificada del proveedor. Las de transferencia las confirma un administrador en *Admin → Billetera*.
- **Pagar con saldo:** el pedido queda pagado al instante. El débito y la confirmación ocurren en la misma transacción, con bloqueo de fila, así que el saldo nunca queda negativo.
- **Reembolsos:**
  - Desde un pedido: cambia el estado a *Reembolsado* y marca «Reembolsar a la billetera».
  - Desde un reporte de cuenta caída: el monto sugerido es proporcional a los días de servicio restantes.
- **Recargas manuales desde el panel:** en *Admin → Billetera → Recarga manual* (o *Clientes → Billetera*) buscas al cliente, indicas el monto, cómo recibiste el dinero (Nequi, Daviplata, Bancolombia, efectivo, cripto u otro) y el número de comprobante. El saldo se acredita al instante, el cliente recibe una notificación y el mismo comprobante no se puede usar dos veces.
- **Ajustes:** para corregir un saldo (crédito o débito) con motivo obligatorio. Quedan auditados con el administrador que los hizo.

## Inventario de cuentas y entrega automática

En el producto, elige **Entrega: Automática desde inventario**, la **duración del servicio (días)** y el umbral de **alerta de poco stock**.

- **Carga:** en *Admin → Inventario de cuentas → Agregar cuentas*, una por línea, con el formato `credenciales | etiqueta | AAAA-MM-DD`. Las credenciales se guardan **cifradas** (AES-256-GCM) con una llave que se genera sola al instalar y queda en la base de datos: haz copias de seguridad de la base.
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

Las credenciales se ingresan en *Admin → Configuración → Pagos, correo y acceso*, que también muestra las URL de webhook para copiar. Mientras falten, el método aparece como **«Pendiente de configuración»** y no se puede seleccionar.

| Método | Datos en el panel | URL de notificación (webhook) |
|---|---|---|
| Mercado Pago (Checkout Pro) | Access token y clave del webhook | `{URL}/api/payments/webhooks/mercadopago` (evento *Pagos*) |
| Wompi (Nequi, Bancolombia, PSE, tarjetas) | Llave pública, secreto de integridad y de eventos | `{URL}/api/payments/webhooks/wompi` |
| Transferencia (Nequi/Daviplata/Bancolombia) | Activar «Transferencias» | Confirmación manual en el panel |
| Zenobank (cripto: USDT, USDC, BTC…) | API key `sk_…`, secreto `whsec_…` y moneda (+ tasa si cotizas en USD) | `{URL}/api/payments/webhooks/zenobank` |
| Billetera NexiStore | — | Interno: se descuenta del saldo |
| PayPal | — | **No integrado**: se muestra como «No disponible» |

**Zenobank** se integra como su SDK oficial: `POST /api/v1/checkouts` con la cabecera `X-API-Key`. Cada pedido o recarga se cotiza en la moneda configurada (USD por defecto) con la tasa del panel, redondeando hacia arriba a 2 decimales, y la cotización queda guardada. El webhook se verifica con la firma `zeno-signature` (HMAC-SHA256 con el secreto `whsec_` y una tolerancia de 5 minutos). Después se consulta el checkout en la API y solo se confirma si el estado es `COMPLETED` con el monto exacto. Los pagos parciales y los vencidos no se confirman.

Prueba primero con llaves de *sandbox*: las llaves `pub_test_` de Wompi usan su entorno de pruebas automáticamente. Al volver de la pasarela, la página de confirmación consulta el estado al proveedor desde el servidor, así que el pedido se confirma aunque el webhook tarde.

Los pedidos sin pagar se cancelan automáticamente a las 48 horas y liberan el inventario reservado.

## Seguridad

- **Inyección SQL:** todas las consultas usan parámetros, la búsqueda escapa `%` y `_`, y `multipleStatements` está desactivado.
- **XSS:** React escapa todo el contenido, el blog se renderiza como texto y hay una política CSP estricta con Helmet.
- **CSRF:** cookie y cabecera de doble envío en cada mutación, verificación de `Origin` y cookies `SameSite=Lax`.
- **Credenciales del inventario:** cifradas en reposo (AES-256-GCM) con una llave generada al instalar y guardada en la base de datos (o en `INVENTORY_ENCRYPTION_KEY` si la defines); solo se muestran al cliente con el pedido completado y al administrador en el detalle de la cuenta.
- **Sesiones:** token aleatorio en cookie `httpOnly`; en la base de datos solo se guarda su hash SHA-256. Las contraseñas usan scrypt con sal.
- **Acceso:** el rol se comprueba en el servidor (`requireAuth` y `requireAdmin`) y cada cliente solo ve sus propios pedidos.
- **Abuso:** límite de intentos en login, registro y recuperación. La recuperación no revela si un correo existe y sus enlaces caducan en 1 hora y son de un solo uso.
- **CSV:** la exportación neutraliza fórmulas (inyección CSV).
- **Secretos:** nunca en el código. Las claves de pasarelas y SMTP se guardan en la base de datos y la API del panel nunca las devuelve completas. `.env` está en `.gitignore`.

## Inicio de sesión con Google (opcional)

Crea credenciales OAuth en Google Cloud con la URI de redirección `{URL}/api/auth/google/callback` (el panel la muestra) y pega el Client ID y el Client secret en *Configuración*. Sin ellas, el botón aparece deshabilitado con el aviso «pendiente de configuración».

## Pendiente antes de vender

- Reemplazar los productos de ejemplo por el catálogo real.
- Sustituir los textos de **Términos** y **Privacidad** por versiones revisadas legalmente (Ley 1480 de 2011 y Ley 1581 de 2012).
- Configurar las credenciales de la pasarela y hacer una compra real de bajo valor en producción.
