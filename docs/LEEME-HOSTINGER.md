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

## 3. Variables de entorno (solo base de datos y administrador)

En la sección de variables de entorno de la app Node.js en hPanel agrega **únicamente** estas:

| Variable | Valor |
|---|---|
| `DB_HOST` | `localhost` (o el host que indique hPanel) |
| `DB_PORT` | `3306` |
| `DB_USER` / `DB_PASSWORD` / `DB_NAME` | Los del paso 1 |
| `ADMIN_EMAIL` | Tu correo de administrador |
| `ADMIN_PASSWORD` | Una contraseña de 8+ caracteres con letras y números |
| `SEED_DEMO` *(opcional)* | `true` para cargar el catálogo de ejemplo si la base está vacía |

Si el panel trae otras variables vacías puedes dejarlas así: se ignoran.

> `ADMIN_EMAIL` y `ADMIN_PASSWORD` crean el **primer administrador** al arrancar, solo si todavía no hay ninguno. Después de entrar, cambia la contraseña desde *Mi cuenta* y borra `ADMIN_PASSWORD` de las variables.

## 4. Despliega y comprueba

1. Activa el **SSL** del dominio en hPanel. La tienda debe servirse por HTTPS porque las cookies de sesión son seguras.
2. Despliega y abre `https://tu-dominio.com/api/health`: debe responder `{"ok":true}`.
3. Entra a `https://tu-dominio.com/ingresar` con tu correo y contraseña de administrador, y luego ve a `/admin`.

## 5. Configura todo desde el panel

Ve a **Admin → Configuración → «Pagos, correo y acceso»**. Ahí configuras todo, sin tocar el servidor:

| Sección | Qué pones | Dónde lo consigues |
|---|---|---|
| **Wompi** (Nequi, Bancolombia, PSE, tarjetas) | Llave pública, secreto de integridad y secreto de eventos | Dashboard de Wompi → Desarrolladores |
| **Mercado Pago** | Access token y clave del webhook | Mercado Pago → Tus integraciones → Credenciales |
| **Zenobank** (cripto) | API key `sk_…`, secreto del webhook `whsec_…` y moneda | Dashboard de Zenobank → Developers |
| **Transferencias** | Activar o desactivar | — |
| **Correo (SMTP)** | `smtp.hostinger.com`, puerto `465`, buzón y contraseña | hPanel → Correos. Usa «Enviar correo de prueba» para verificarlo |
| **Google** (opcional) | Client ID y Client secret | Google Cloud → Credenciales |
| **Dirección de la tienda** | `https://tu-dominio.com` | Si la dejas vacía se usa la dirección con la que entras |

Cada sección te muestra la **URL del webhook** lista para copiar y pegar en el panel del proveedor. Los cambios se aplican al instante, sin reiniciar.
Las claves secretas nunca se vuelven a mostrar completas: solo verás «Guardado ••••1234».

Si cobras con Zenobank en USD, define la tasa en **Admin → Configuración → Criptomonedas**.

**Llave de cifrado del inventario:** se genera sola la primera vez y se guarda en la base de datos. Haz **copias de seguridad de la base de datos** (hPanel → Bases de datos → Copias de seguridad): sin ellas no se pueden recuperar las cuentas del inventario.

## 6. Primeros pasos en el panel

- **Productos:** crea o edita tu catálogo. Para cuentas con entrega automática, elige «Entrega automática desde inventario» y carga las cuentas en **Inventario de cuentas**.
- **Configuración:** escribe el correo de soporte y las instrucciones de pago por transferencia, y ajusta la campaña de temporada.
- **Billetera:** recarga saldo manualmente a tus clientes cuando te paguen por fuera.

## Actualizar a una nueva versión

Sube el nuevo ZIP sobre la misma app y vuelve a desplegar. Las migraciones nuevas se aplican solas al arrancar y tus datos se conservan.

## Si algo falla

- **La app no arranca:** revisa los registros (logs) de la app en hPanel. «Variables de entorno inválidas» indica cuál falta o está mal escrita.
- **Error de base de datos:** verifica `DB_HOST`, `DB_USER`, `DB_PASSWORD` y `DB_NAME`, y que el usuario tenga permisos sobre la base.
- **No inicia sesión o el formulario «expira»:** entra siempre por `https://` y revisa en *Configuración → Dirección de la tienda* que la URL sea exactamente tu dominio (o déjala vacía).
- **Un método de pago aparece «pendiente de configuración»:** completa sus claves en *Configuración → Pagos, correo y acceso*.
- **No llegan los correos:** usa «Enviar correo de prueba» en la sección Correo (SMTP); el mensaje de error indica qué falla.
