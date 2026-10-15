/**
 * Datos de ejemplo. Productos y marcas FICTICIOS con arte propio: reemplázalos desde el panel
 * de administración por tu catálogo real (licencias, claves o tarjetas de distribuidores autorizados).
 */

export const seedCategories = [
  { slug: "streaming", name: "Streaming", description: "Películas, series y TV en vivo.", icon: "tv", color: "#e3122c" },
  { slug: "software", name: "Software", description: "Ofimática, seguridad y utilidades.", icon: "monitor", color: "#2f7bff" },
  { slug: "juegos", name: "Juegos", description: "Suscripciones y créditos para jugar.", icon: "gamepad-2", color: "#8b5cf6" },
  { slug: "musica", name: "Música", description: "Música y podcasts sin anuncios.", icon: "music", color: "#1fbf75" },
  { slug: "ia", name: "IA", description: "Asistentes y herramientas de inteligencia artificial.", icon: "sparkles", color: "#13b5c9" },
  { slug: "diseno", name: "Diseño", description: "Edición de foto, video y diseño gráfico.", icon: "palette", color: "#d63384" },
  { slug: "cursos", name: "Cursos", description: "Aprende programación, idiomas y más.", icon: "graduation-cap", color: "#f2711c" },
  { slug: "moviles", name: "Móviles", description: "Recargas, apps y herramientas para tu celular.", icon: "smartphone", color: "#0ea5e9" },
  { slug: "tarjetas-regalo", name: "Tarjetas regalo", description: "Regala saldo para usar en NexiStore.", icon: "gift", color: "#e9b949" },
];

const WARRANTY = "Garantía de funcionamiento durante todo el periodo contratado. Si presentas un inconveniente, abre una solicitud desde tu panel y lo resolvemos o te devolvemos el dinero.";
const DELIVERY = "Entrega digital en tu panel de usuario (Mis pedidos → Ver detalle) una vez confirmado el pago. Tiempo habitual: menos de 15 minutos en horario de atención.";

interface SeedProduct {
  slug: string;
  category: string;
  name: string;
  summary: string;
  glyph: string;
  price: number;
  compareAt?: number;
  stock: number;
  featured?: boolean;
  duration: string;
  account: string;
  description: string;
  includes: string;
  instructions: string;
}

export const seedProducts: SeedProduct[] = [
  {
    slug: "cineplus-premium-anual", category: "streaming", name: "CinePlus Premium", summary: "1 año · Perfil individual", glyph: "C+",
    price: 29900, compareAt: 49900, stock: 40, featured: true, duration: "1 año de duración", account: "Perfil individual",
    description: "Acceso a todo el catálogo de CinePlus durante 12 meses: estrenos, series originales y documentales en calidad 4K HDR, en el dispositivo que prefieras.",
    includes: "• Catálogo completo en 4K HDR\n• 1 perfil personal con PIN\n• Descargas para ver sin conexión",
    instructions: "1. Abre CinePlus en tu dispositivo.\n2. Ingresa con los datos que aparecen en el detalle de tu pedido.\n3. Selecciona tu perfil y personaliza el PIN.",
  },
  {
    slug: "cineplus-familiar", category: "streaming", name: "CinePlus Familiar", summary: "6 meses · 4 pantallas", glyph: "C+",
    price: 59900, compareAt: 89900, stock: 18, duration: "6 meses de duración", account: "4 pantallas simultáneas",
    description: "El plan familiar de CinePlus para ver en cuatro pantallas a la vez, con perfiles para cada miembro de la casa y control parental.",
    includes: "• 4 pantallas simultáneas\n• Perfiles infantiles\n• Calidad 4K HDR",
    instructions: "1. Ingresa con los datos entregados.\n2. Crea un perfil por persona.\n3. Activa el control parental en Ajustes.",
  },
  {
    slug: "docuplay-anual", category: "streaming", name: "DocuPlay", summary: "1 año · Individual", glyph: "D",
    price: 34900, compareAt: 54900, stock: 25, duration: "1 año de duración", account: "Cuenta individual",
    description: "Documentales de naturaleza, ciencia e historia sin anuncios. Nuevos estrenos cada semana.",
    includes: "• Catálogo completo sin anuncios\n• Subtítulos en español\n• Descargas offline",
    instructions: "1. Descarga DocuPlay.\n2. Inicia sesión con los datos de tu pedido.",
  },
  {
    slug: "sonora-premium-anual", category: "musica", name: "Sonora Premium", summary: "1 año · Individual", glyph: "S",
    price: 24900, compareAt: 39900, stock: 50, featured: true, duration: "1 año de duración", account: "Cuenta individual",
    description: "Más de 100 millones de canciones y podcasts sin anuncios, con descargas y calidad de audio sin pérdida.",
    includes: "• Música sin anuncios\n• Descargas ilimitadas\n• Audio sin pérdida",
    instructions: "1. Abre Sonora.\n2. Canjea el código de tu pedido en Cuenta → Canjear.",
  },
  {
    slug: "sonora-familiar", category: "musica", name: "Sonora Familiar", summary: "6 meses · 6 cuentas", glyph: "S",
    price: 44900, compareAt: 64900, stock: 20, duration: "6 meses de duración", account: "Hasta 6 cuentas",
    description: "Seis cuentas Premium independientes para la familia, cada una con sus listas y recomendaciones.",
    includes: "• 6 cuentas Premium\n• Mezcla familiar\n• Control de contenido explícito",
    instructions: "1. El titular canjea el código.\n2. Invita a los miembros desde Cuenta → Familia.",
  },
  {
    slug: "podlibre-plus", category: "musica", name: "PodLibre Plus", summary: "1 año · Individual", glyph: "P",
    price: 19900, stock: 30, duration: "1 año de duración", account: "Cuenta individual",
    description: "Podcasts exclusivos y episodios anticipados de tus programas favoritos, sin anuncios.",
    includes: "• Episodios sin anuncios\n• Contenido exclusivo",
    instructions: "1. Inicia sesión en PodLibre.\n2. Canjea el código desde tu perfil.",
  },
  {
    slug: "suite-ofimatica-pro", category: "software", name: "Suite Ofimática Pro", summary: "1 año · 5 dispositivos", glyph: "Su",
    price: 39900, compareAt: 69900, stock: 35, featured: true, duration: "1 año de duración", account: "5 dispositivos",
    description: "Procesador de texto, hojas de cálculo, presentaciones y 1 TB de almacenamiento en la nube para cinco dispositivos.",
    includes: "• Apps de escritorio y móviles\n• 1 TB en la nube\n• 5 dispositivos",
    instructions: "1. Ingresa al portal de la Suite.\n2. Canjea la licencia de tu pedido.\n3. Descarga e instala las apps.",
  },
  {
    slug: "escudo-total-antivirus", category: "software", name: "Escudo Total", summary: "1 año · 3 equipos", glyph: "E",
    price: 49900, compareAt: 79900, stock: 22, duration: "1 año de duración", account: "3 equipos",
    description: "Protección en tiempo real contra malware, ransomware y phishing, con VPN básica incluida.",
    includes: "• Antivirus y antiransomware\n• VPN 200 MB/día\n• Gestor de contraseñas",
    instructions: "1. Descarga Escudo Total.\n2. Activa con la clave de licencia de tu pedido.",
  },
  {
    slug: "pdf-maestro", category: "software", name: "PDF Maestro", summary: "Licencia perpetua · 1 equipo", glyph: "Pd",
    price: 89900, stock: 12, duration: "Licencia perpetua", account: "1 equipo",
    description: "Edita, convierte, firma y protege documentos PDF. Licencia de por vida para un equipo.",
    includes: "• Edición y OCR\n• Firma electrónica\n• Conversión a Word y Excel",
    instructions: "1. Descarga el instalador oficial.\n2. Introduce la clave de tu pedido.",
  },
  {
    slug: "arcadia-pass-3-meses", category: "juegos", name: "Arcadia Pass", summary: "3 meses · Consola y PC", glyph: "A",
    price: 54900, compareAt: 84900, stock: 30, featured: true, duration: "3 meses de duración", account: "Consola y PC",
    description: "Cientos de juegos en consola y PC, estrenos desde el primer día y juego en línea incluido.",
    includes: "• Biblioteca de +300 juegos\n• Multijugador en línea\n• Descuentos para miembros",
    instructions: "1. Abre la tienda de tu consola.\n2. Canjea el código de 25 caracteres.",
  },
  {
    slug: "pixelcoins-50000", category: "juegos", name: "PixelCoins $50.000", summary: "Tarjeta de saldo", glyph: "Px",
    price: 50000, stock: 60, duration: "Sin vencimiento", account: "Saldo recargable",
    description: "Saldo para comprar juegos, expansiones y artículos en la tienda PixelCoins.",
    includes: "• Saldo de $50.000\n• No vence",
    instructions: "1. Ingresa a PixelCoins.\n2. Ve a Recargar saldo y pega el código.",
  },
  {
    slug: "lumen-ai-pro", category: "ia", name: "Lumen AI Pro", summary: "1 mes · Individual", glyph: "L",
    price: 79900, stock: 25, featured: true, duration: "1 mes de duración", account: "Cuenta individual",
    description: "Asistente de inteligencia artificial con modelos avanzados, análisis de archivos y generación de imágenes.",
    includes: "• Modelos avanzados\n• Análisis de documentos\n• Generación de imágenes",
    instructions: "1. Crea tu cuenta en Lumen AI.\n2. Canjea el código Pro en Ajustes → Plan.",
  },
  {
    slug: "pincel-ia-creditos", category: "ia", name: "Pincel IA", summary: "500 créditos", glyph: "Pi",
    price: 32900, compareAt: 44900, stock: 40, duration: "Créditos sin vencimiento", account: "Cuenta individual",
    description: "Genera ilustraciones y fotos con IA a partir de texto. 500 créditos para usar cuando quieras.",
    includes: "• 500 créditos\n• Uso comercial permitido",
    instructions: "1. Inicia sesión en Pincel IA.\n2. Canjea el código en Créditos.",
  },
  {
    slug: "lienzo-pro-equipos", category: "diseno", name: "Lienzo Pro", summary: "1 año · Equipo de 5", glyph: "Li",
    price: 89900, compareAt: 129900, stock: 15, featured: true, duration: "1 año de duración", account: "Equipo de 5 personas",
    description: "Diseño gráfico colaborativo con plantillas premium, kit de marca y quitar fondos con un clic.",
    includes: "• Plantillas premium\n• Kit de marca\n• 1 TB de almacenamiento",
    instructions: "1. Acepta la invitación que llegará a tu correo.\n2. Invita a tu equipo desde Configuración.",
  },
  {
    slug: "cortes-video-pro", category: "diseno", name: "Cortes Pro", summary: "1 año · Individual", glyph: "Co",
    price: 59900, compareAt: 79900, stock: 20, duration: "1 año de duración", account: "Cuenta individual",
    description: "Editor de video con efectos, subtítulos automáticos y exportación en 4K sin marca de agua.",
    includes: "• Exportación 4K\n• Subtítulos automáticos\n• Biblioteca de efectos",
    instructions: "1. Descarga Cortes Pro.\n2. Activa con el código de tu pedido.",
  },
  {
    slug: "academia-dev-fullstack", category: "cursos", name: "Academia Dev Full Stack", summary: "Acceso 1 año · Certificado", glyph: "AD",
    price: 119900, compareAt: 199900, stock: 100, duration: "1 año de acceso", account: "Cuenta individual",
    description: "Ruta completa de desarrollo web: HTML, CSS, JavaScript, React, Node.js y bases de datos, con proyectos reales y certificado.",
    includes: "• +180 horas de video\n• Proyectos guiados\n• Certificado de finalización",
    instructions: "1. Regístrate en Academia Dev.\n2. Canjea el cupón de acceso de tu pedido.",
  },
  {
    slug: "ingles-total", category: "cursos", name: "Inglés Total", summary: "6 meses · Todos los niveles", glyph: "En",
    price: 69900, compareAt: 99900, stock: 100, duration: "6 meses de acceso", account: "Cuenta individual",
    description: "Curso de inglés con clases en vivo, práctica de conversación con IA y prueba de nivel.",
    includes: "• Clases en vivo semanales\n• Práctica con IA\n• Certificado por nivel",
    instructions: "1. Crea tu cuenta.\n2. Introduce el código de acceso.",
  },
  {
    slug: "recarga-movil-20000", category: "moviles", name: "Recarga móvil $20.000", summary: "Todos los operadores", glyph: "R",
    price: 20000, stock: 200, duration: "Inmediata", account: "Cualquier operador",
    description: "Recarga de saldo para cualquier operador en Colombia. Indica tu número en las notas del pedido.",
    includes: "• $20.000 de saldo\n• Todos los operadores",
    instructions: "Escribe tu número de celular en las notas del pedido. La recarga se aplica al confirmarse el pago.",
  },
  {
    slug: "fit-app-pro", category: "moviles", name: "FitApp Pro", summary: "1 año · iOS y Android", glyph: "F",
    price: 39900, compareAt: 59900, stock: 30, duration: "1 año de duración", account: "Cuenta individual",
    description: "Planes de entrenamiento personalizados, nutrición y seguimiento de progreso.",
    includes: "• Rutinas personalizadas\n• Plan de nutrición\n• Sin anuncios",
    instructions: "1. Descarga FitApp.\n2. Canjea el código en Perfil → Suscripción.",
  },
  {
    slug: "tarjeta-regalo-nexistore-50000", category: "tarjetas-regalo", name: "Tarjeta regalo NexiStore $50.000", summary: "Saldo para cualquier producto", glyph: "$",
    price: 50000, stock: 500, featured: true, duration: "Vigencia de 1 año", account: "Saldo NexiStore",
    description: "Regala saldo para comprar cualquier producto de NexiStore. Se entrega como código para compartir.",
    includes: "• $50.000 de saldo\n• Vigencia de 12 meses",
    instructions: "Comparte el código con la persona que recibirá el regalo. Puede usarlo en su próxima compra a través de soporte.",
  },
  {
    slug: "tarjeta-regalo-nexistore-100000", category: "tarjetas-regalo", name: "Tarjeta regalo NexiStore $100.000", summary: "Saldo para cualquier producto", glyph: "$",
    price: 100000, stock: 500, duration: "Vigencia de 1 año", account: "Saldo NexiStore",
    description: "Regala saldo para comprar cualquier producto de NexiStore. Se entrega como código para compartir.",
    includes: "• $100.000 de saldo\n• Vigencia de 12 meses",
    instructions: "Comparte el código con la persona que recibirá el regalo.",
  },
];

export const seedProductDefaults = { warranty: WARRANTY, delivery: DELIVERY };

export const seedCoupons = [
  { code: "NAVIDAD10", description: "10% adicional en compras desde $50.000", kind: "percent" as const, value: 10, minSubtotal: 50000 },
  { code: "BIENVENIDA", description: "$5.000 de descuento en tu primera compra", kind: "fixed" as const, value: 5000, minSubtotal: 30000 },
];

export const seedPosts = [
  {
    slug: "como-recibir-tu-producto-digital",
    title: "Cómo recibir tu producto digital",
    excerpt: "Paso a paso desde el pago hasta que tienes tu acceso listo.",
    body:
      "Cuando tu pago se confirma, el pedido pasa a «Pagado» y nuestro equipo prepara la entrega.\n\nEn cuanto esté lista, el pedido cambia a «Completado» y verás los datos de acceso en Mis pedidos → Ver detalle.\n\nSi algo no funciona, abre una solicitud desde Soporte indicando el código del pedido.",
  },
  {
    slug: "regalos-digitales-esta-navidad",
    title: "Ideas de regalos digitales para esta Navidad",
    excerpt: "Suscripciones, cursos y tarjetas regalo que llegan al instante.",
    body:
      "Los regalos digitales no se pierden en el envío y llegan en minutos.\n\nPara quien ama el cine: un año de streaming. Para quien quiere aprender: un curso con certificado. Y si no sabes qué elegir, una tarjeta regalo NexiStore siempre acierta.",
  },
];
