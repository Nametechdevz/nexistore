import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { Icon } from "../components/Icon";
import { useDocumentTitle } from "../lib/hooks";
import { useSession, useStore } from "../lib/state";

/**
 * Términos y condiciones y Política de tratamiento de datos.
 * Los datos del responsable (razón social, NIT, dirección, contacto) salen de Admin → Configuración → Datos de la tienda.
 */

const UPDATED = "15 de octubre de 2026";

type Sec = { id: string; title: string; body: ReactNode };

function useLegalData() {
  const info = useStore();
  const s = info?.store;
  const name = s?.storeName || "NexiStore";
  const site = typeof window !== "undefined" ? window.location.host : "";
  const owner = s?.legalName || name;
  const email = s?.supportEmail || "";
  const whatsapp = s?.supportWhatsapp || "";
  const methods = info?.paymentMethods.filter((m) => m.configured).map((m) => m.label) ?? [];
  return { name, site, owner, legalId: s?.legalId || "", address: s?.legalAddress || "", city: s?.legalCity || "", email, whatsapp, methods };
}

function Contact({ email, whatsapp }: { email: string; whatsapp: string }) {
  return (
    <>
      {email && (
        <>
          el correo <a className="text-accent" href={`mailto:${email}`}>{email}</a>
        </>
      )}
      {email && whatsapp && ", "}
      {whatsapp && <>el WhatsApp {whatsapp}</>}
      {(email || whatsapp) && " o "}
      la sección <Link className="text-accent" to="/cuenta/soporte">Soporte</Link> de tu cuenta
    </>
  );
}

function OwnerCard() {
  const d = useLegalData();
  const { user } = useSession();
  const missing = !d.email || !d.address || !d.legalId;
  return (
    <>
      {user?.role === "admin" && missing && (
        <div className="alert alert-warning" style={{ marginBottom: 20 }}>
          <Icon name="alert" />
          <div>
            Solo lo ves tú: completa la razón social, el NIT o cédula, la dirección y el correo de soporte en{" "}
            <Link className="text-accent" to="/admin/configuracion">Configuración → Datos de la tienda</Link> para que aparezcan aquí.
          </div>
        </div>
      )}
      <div className="legal-owner">
        <div>
          <span>Responsable</span>
          <strong>{d.owner}</strong>
          {d.legalId && <small>NIT / C.C. {d.legalId}</small>}
        </div>
        {(d.address || d.city) && (
          <div>
            <span>Domicilio</span>
            <strong>{[d.address, d.city].filter(Boolean).join(", ")}</strong>
            <small>Colombia</small>
          </div>
        )}
        <div>
          <span>Contacto</span>
          {d.email && <strong>{d.email}</strong>}
          {d.whatsapp && <small>WhatsApp {d.whatsapp}</small>}
          <small>{d.site}</small>
        </div>
      </div>
    </>
  );
}

function LegalLayout({ title, intro, sections }: { title: string; intro: ReactNode; sections: Sec[] }) {
  useDocumentTitle(title);
  // En computador el índice queda abierto y fijo; en celular empieza plegado.
  const wide = typeof window !== "undefined" && window.matchMedia("(min-width: 901px)").matches;
  return (
    <div className="container legal">
      <header className="legal-head">
        <p className="eyebrow">Información legal</p>
        <h1 className="page-title">{title}</h1>
        <p className="muted">Última actualización: {UPDATED}</p>
        <div className="legal-intro">{intro}</div>
      </header>
      <div className="legal-grid">
        <details className="legal-toc" open={wide}>
          <summary>
            <strong>Contenido</strong>
            <Icon name="chevron-down" className="chev" />
          </summary>
          <ol>
            {sections.map((s, i) => (
              <li key={s.id}>
                <a href={`#${s.id}`}>
                  <span className="num">{i + 1}.</span> {s.title}
                </a>
              </li>
            ))}
          </ol>
        </details>
        <article className="legal-body">
          <OwnerCard />
          {sections.map((s, i) => (
            <section key={s.id} id={s.id} className="legal-sec">
              <h2>
                <span className="num">{i + 1}.</span> {s.title}
              </h2>
              <div className="prose">{s.body}</div>
            </section>
          ))}
          <p className="legal-foot">
            ¿Tienes dudas sobre este documento? Escríbenos y te respondemos con gusto. Consulta también nuestra{" "}
            {title.startsWith("Términos") ? <Link className="text-accent" to="/privacidad">Política de privacidad</Link> : <Link className="text-accent" to="/terminos">Términos y condiciones</Link>}.
          </p>
        </article>
      </div>
    </div>
  );
}

export function TermsPage() {
  const d = useLegalData();
  const sections: Sec[] = [
    {
      id: "aceptacion",
      title: "Aceptación y alcance",
      body: (
        <>
          <p>
            Estos términos regulan el uso del sitio <strong>{d.site}</strong> y la compra de los productos digitales que ofrece <strong>{d.name}</strong>
            {d.owner !== d.name ? <> (operado por {d.owner})</> : null}. Al crear una cuenta o hacer un pedido declaras que los leíste y los aceptas, junto con la{" "}
            <Link className="text-accent" to="/privacidad">Política de privacidad</Link>.
          </p>
          <p>
            Se aplican la Ley 1480 de 2011 (Estatuto del Consumidor), la Ley 527 de 1999 (comercio electrónico) y las demás normas colombianas vigentes. Ninguna cláusula
            limita los derechos que la ley te reconoce como consumidor.
          </p>
        </>
      ),
    },
    {
      id: "cuenta",
      title: "Cuenta de usuario",
      body: (
        <ul>
          <li>Para comprar necesitas una cuenta con datos reales y actualizados. Debes ser mayor de 18 años o comprar con autorización de tu representante legal.</li>
          <li>Eres responsable de mantener tu contraseña en reserva y de la actividad que se haga desde tu cuenta. Si sospechas de un acceso no autorizado, cambia la contraseña y avísanos.</li>
          <li>Podemos suspender cuentas usadas para fraude, suplantación, contracargos de mala fe o incumplimiento de estos términos, previa comunicación al titular.</li>
        </ul>
      ),
    },
    {
      id: "productos",
      title: "Productos y precios",
      body: (
        <>
          <p>
            Vendemos productos digitales: accesos y suscripciones a servicios de streaming, música, software, juegos, herramientas de IA, cursos, recargas y tarjetas de regalo,
            entre otros. Cada ficha indica la duración, el tipo de cuenta, lo que incluye, las instrucciones y la garantía; esa información hace parte de la oferta.
          </p>
          <ul>
            <li>Los precios están en pesos colombianos (COP) e incluyen los impuestos aplicables. El precio que pagas es el que ves al confirmar el pedido.</li>
            <li>Las promociones y cupones tienen las condiciones y vigencia que se indiquen y no son acumulables salvo que se diga lo contrario.</li>
            <li>La disponibilidad depende del inventario. Si un producto se agota después de tu pago, te ofrecemos un producto equivalente o la devolución total del dinero.</li>
            <li>
              Las marcas y logotipos de terceros que se mencionan pertenecen a sus titulares. {d.name} no está afiliada ni patrocinada por ellos, salvo que se indique
              expresamente.
            </li>
          </ul>
        </>
      ),
    },
    {
      id: "pedidos",
      title: "Pedidos y pagos",
      body: (
        <>
          <p>
            El contrato se perfecciona cuando el pago queda confirmado. Puedes pagar con{" "}
            {d.methods.length ? <strong>{d.methods.join(", ")}</strong> : "los medios de pago habilitados en el checkout"}.
          </p>
          <ul>
            <li>Los pagos con tarjeta, PSE, Nequi, Mercado Pago o criptomonedas se procesan en la plataforma de cada pasarela. {d.name} no conoce ni guarda los datos de tus tarjetas.</li>
            <li>Un pedido solo se confirma cuando la pasarela o nuestro equipo verifican que el pago llegó por el valor exacto. En pagos con criptomonedas, el valor se cotiza al crear el pedido y los pagos parciales no confirman el pedido.</li>
            <li>Las transferencias se confirman cuando verificamos el comprobante. Los pedidos que siguen sin pagar a las 48 horas se cancelan automáticamente.</li>
            <li>Recibirás el estado del pedido en tu cuenta (Mis pedidos) y por correo electrónico.</li>
          </ul>
        </>
      ),
    },
    {
      id: "billetera",
      title: "Billetera (saldo a favor)",
      body: (
        <ul>
          <li>Puedes recargar saldo para pagar tus compras en la tienda. Las recargas se acreditan cuando se confirma el pago.</li>
          <li>El saldo es personal e intransferible, no genera intereses y solo se usa en {d.name}.</li>
          <li>Los reembolsos que aceptes recibir como saldo se acreditan de inmediato. Si prefieres la devolución en dinero, puedes pedirla a soporte en los casos previstos en la ley.</li>
        </ul>
      ),
    },
    {
      id: "entrega",
      title: "Entrega",
      body: (
        <>
          <p>La entrega es digital. Los datos de acceso aparecen en <strong>Mis pedidos → Ver detalle</strong> y, si aplica, te avisamos por correo.</p>
          <ul>
            <li><strong>Entrega automática:</strong> se hace en el momento en que se confirma el pago.</li>
            <li><strong>Entrega manual:</strong> la hace nuestro equipo dentro del plazo indicado en el producto; si no se indica, dentro de las 24 horas siguientes a la confirmación del pago.</li>
            <li>Si la entrega no ocurre en ese plazo, puedes pedir la entrega inmediata o la devolución total del dinero.</li>
          </ul>
        </>
      ),
    },
    {
      id: "uso",
      title: "Uso de los productos",
      body: (
        <ul>
          <li>Sigue las instrucciones de uso de cada producto. Si recibes un perfil o un acceso compartido, no cambies la contraseña, el correo, el plan ni los perfiles de otros usuarios, y no compartas los datos con terceros.</li>
          <li>El uso indebido que cause la suspensión del acceso, o los cambios no autorizados en la cuenta, no están cubiertos por la garantía.</li>
          <li>Te comprometes a usar los productos de forma lícita y conforme a las condiciones del servicio correspondiente.</li>
        </ul>
      ),
    },
    {
      id: "garantia",
      title: "Garantía y soporte",
      body: (
        <>
          <p>
            Todo producto tiene garantía de funcionamiento durante el periodo contratado (garantía legal, artículos 7 y siguientes de la Ley 1480 de 2011). Si un acceso deja de
            funcionar por causas ajenas a ti:
          </p>
          <ol>
            <li>Repórtalo desde <strong>Mis pedidos → Ver detalle → «Reportar falla»</strong> o en Soporte, indicando el código del pedido.</li>
            <li>Revisamos el caso y, si procede, te damos un reemplazo de las mismas características por el tiempo que te queda.</li>
            <li>Si no es posible reemplazarlo, te devolvemos el valor proporcional al tiempo no usado, como saldo o al medio de pago, como prefieras.</li>
          </ol>
          <p>Atendemos las solicitudes en el menor tiempo posible y, a más tardar, dentro de los 15 días hábiles siguientes.</p>
        </>
      ),
    },
    {
      id: "retracto",
      title: "Derecho de retracto",
      body: (
        <>
          <p>
            En las compras por internet tienes derecho a retractarte dentro de los <strong>5 días hábiles</strong> siguientes a la compra (artículo 47 de la Ley 1480 de 2011).
            En ese caso te devolvemos todo el dinero dentro de los 30 días calendario siguientes.
          </p>
          <p>
            Ese mismo artículo excluye los servicios cuya prestación ya comenzó con tu acuerdo. Al confirmar el pedido aceptas que la entrega digital comience de inmediato; por
            eso, una vez entregados y usados los datos de acceso, ya no procede el retracto. Mientras el pedido no se haya entregado, puedes retractarte sin costo desde Soporte.
          </p>
        </>
      ),
    },
    {
      id: "reversion",
      title: "Reversión del pago",
      body: (
        <>
          <p>
            Si pagaste con tarjeta de crédito, débito u otro medio electrónico, puedes pedir la reversión del pago (artículo 51 de la Ley 1480 de 2011 y Decreto 587 de 2016) cuando:
            fuiste víctima de fraude, la operación no fue solicitada, no recibiste el producto, o el producto no corresponde a lo pedido o es defectuoso.
          </p>
          <p>
            Debes presentar la queja ante nosotros y ante el emisor del medio de pago dentro de los <strong>5 días hábiles</strong> siguientes a la fecha en que conociste el hecho
            o recibiste el producto. Si procede, deshabilitaremos el acceso entregado.
          </p>
        </>
      ),
    },
    {
      id: "responsabilidad",
      title: "Responsabilidad",
      body: (
        <ul>
          <li>Los servicios que se acceden con nuestros productos son prestados por sus respectivos proveedores, que pueden modificar sus funciones, catálogos o condiciones. Cuando esto afecte tu acceso, aplicamos la garantía descrita arriba.</li>
          <li>No respondemos por fallas de tu conexión, de tu dispositivo o por usos contrarios a las instrucciones del producto.</li>
          <li>Nada de lo anterior limita la responsabilidad que la ley nos asigna frente al consumidor.</li>
        </ul>
      ),
    },
    {
      id: "pqr",
      title: "Peticiones, quejas y reclamos",
      body: (
        <p>
          Puedes escribirnos por <Contact email={d.email} whatsapp={d.whatsapp} />. Respondemos dentro de los 15 días hábiles siguientes. Si no quedas satisfecho, puedes acudir a la
          Superintendencia de Industria y Comercio (
          <a className="text-accent" href="https://www.sic.gov.co" target="_blank" rel="noreferrer">www.sic.gov.co</a>).
        </p>
      ),
    },
    {
      id: "cambios",
      title: "Cambios a estos términos",
      body: (
        <p>
          Podemos actualizar estos términos; la versión vigente es la publicada en esta página, con su fecha de actualización. Los cambios no afectan los pedidos ya confirmados,
          que se rigen por los términos vigentes al momento de la compra.
        </p>
      ),
    },
    {
      id: "ley",
      title: "Ley aplicable",
      body: <p>Estos términos se rigen por las leyes de la República de Colombia. Las controversias se resolverán ante las autoridades colombianas competentes.</p>,
    },
  ];
  return (
    <LegalLayout
      title="Términos y condiciones"
      intro={<p>Queremos que compres con confianza. Aquí explicamos de forma clara cómo funcionan los pedidos, los pagos, la entrega, la garantía y tus derechos como consumidor.</p>}
      sections={sections}
    />
  );
}

export function PrivacyPage() {
  const d = useLegalData();
  const sections: Sec[] = [
    {
      id: "responsable",
      title: "Responsable del tratamiento",
      body: (
        <p>
          <strong>{d.owner}</strong>
          {d.legalId ? <>, identificado con NIT / C.C. {d.legalId}</> : null}
          {d.address || d.city ? <>, con domicilio en {[d.address, d.city].filter(Boolean).join(", ")}, Colombia</> : null}, es el responsable del tratamiento de los datos
          personales que se recogen en <strong>{d.site}</strong>. Esta política cumple la Ley 1581 de 2012, el Decreto 1377 de 2013 (compilado en el Decreto 1074 de 2015) y
          las demás normas de protección de datos.
        </p>
      ),
    },
    {
      id: "datos",
      title: "Datos que recogemos",
      body: (
        <ul>
          <li><strong>Registro y perfil:</strong> nombre, correo electrónico, celular y, si decides agregarlo, tu documento de identidad. La contraseña se guarda solo como un hash irreversible.</li>
          <li><strong>Inicio de sesión con Google (opcional):</strong> nombre y correo de tu cuenta de Google.</li>
          <li><strong>Compras:</strong> productos, valores, cupones, medio de pago, estado del pedido, movimientos de la billetera y datos de acceso entregados. No recogemos ni guardamos los datos de tus tarjetas.</li>
          <li><strong>Soporte:</strong> los mensajes y solicitudes que nos envías.</li>
          <li><strong>Datos técnicos:</strong> tipo de navegador de cada sesión y, de forma temporal, la dirección IP para proteger el sitio contra abusos.</li>
        </ul>
      ),
    },
    {
      id: "finalidades",
      title: "Para qué usamos tus datos",
      body: (
        <ul>
          <li>Crear y administrar tu cuenta y verificar tu identidad al iniciar sesión.</li>
          <li>Procesar pedidos, pagos, recargas y reembolsos, y entregarte los productos.</li>
          <li>Enviarte avisos sobre tus pedidos, vencimientos de tus servicios, recuperación de contraseña y respuestas de soporte.</li>
          <li>Atender garantías, peticiones, quejas y reclamos.</li>
          <li>Prevenir el fraude y mantener la seguridad del sitio.</li>
          <li>Cumplir obligaciones legales, contables y tributarias.</li>
          <li>Enviarte promociones, solo si lo autorizas. Puedes retirar esa autorización cuando quieras.</li>
        </ul>
      ),
    },
    {
      id: "terceros",
      title: "Con quién compartimos los datos",
      body: (
        <>
          <p>No vendemos tus datos. Solo los compartimos con proveedores que nos ayudan a prestar el servicio, como encargados del tratamiento y bajo deber de confidencialidad:</p>
          <ul>
            <li><strong>Pasarelas de pago</strong>{d.methods.length ? <> ({d.methods.join(", ")})</> : null}: reciben los datos necesarios para procesar tu pago bajo sus propias políticas.</li>
            <li><strong>Alojamiento web y correo electrónico:</strong> almacenan la información del sitio y envían los correos de la tienda. Pueden estar ubicados fuera de Colombia, en países con niveles adecuados de protección o con garantías contractuales, según el artículo 26 de la Ley 1581 de 2012.</li>
            <li><strong>Google</strong>, si eliges iniciar sesión con tu cuenta de Google.</li>
            <li><strong>Autoridades</strong>, cuando una ley o una orden judicial lo exija.</li>
          </ul>
        </>
      ),
    },
    {
      id: "cookies",
      title: "Cookies y almacenamiento local",
      body: (
        <>
          <p>Usamos solo lo necesario para que la tienda funcione. No usamos cookies de publicidad ni de seguimiento de terceros.</p>
          <ul>
            <li><strong>nx_sid:</strong> mantiene tu sesión iniciada. Es segura y no se puede leer desde el navegador.</li>
            <li><strong>nx_csrf:</strong> protege los formularios contra solicitudes falsificadas.</li>
            <li><strong>Almacenamiento local:</strong> recuerda tu carrito en este dispositivo.</li>
          </ul>
        </>
      ),
    },
    {
      id: "seguridad",
      title: "Seguridad",
      body: (
        <ul>
          <li>Conexión cifrada (HTTPS) en todo el sitio.</li>
          <li>Contraseñas guardadas con hash scrypt; nadie del equipo puede verlas.</li>
          <li>Los datos de acceso de los productos se guardan cifrados (AES-256) y solo los ves tú en tu pedido.</li>
          <li>Acceso restringido al panel administrativo, protección contra intentos repetidos de inicio de sesión y verificación de cada pago con la pasarela.</li>
        </ul>
      ),
    },
    {
      id: "conservacion",
      title: "Cuánto tiempo los guardamos",
      body: (
        <p>
          Conservamos tus datos mientras tengas una cuenta activa y durante el tiempo necesario para cumplir las finalidades descritas. Los registros de compras se conservan
          por el plazo que exigen las normas contables y comerciales (hasta 10 años). Cuando ya no se necesiten, se eliminan o se anonimizan.
        </p>
      ),
    },
    {
      id: "derechos",
      title: "Tus derechos",
      body: (
        <>
          <p>Como titular de los datos tienes derecho a (artículo 8 de la Ley 1581 de 2012):</p>
          <ul>
            <li>Conocer, actualizar y rectificar tus datos. Puedes hacerlo directamente en <Link className="text-accent" to="/cuenta/datos">Mis datos</Link>.</li>
            <li>Pedir prueba de la autorización que nos diste.</li>
            <li>Saber cómo hemos usado tus datos.</li>
            <li>Revocar la autorización o pedir que eliminemos tus datos, cuando no exista un deber legal o contractual de conservarlos.</li>
            <li>Acceder gratis a tus datos personales.</li>
            <li>Presentar quejas ante la Superintendencia de Industria y Comercio después de agotar el trámite con nosotros.</li>
          </ul>
        </>
      ),
    },
    {
      id: "procedimiento",
      title: "Cómo ejercer tus derechos",
      body: (
        <>
          <p>
            Escríbenos por <Contact email={d.email} whatsapp={d.whatsapp} />, indicando tu nombre, el correo de tu cuenta, lo que solicitas y, si es un reclamo, los hechos y
            documentos que lo soportan.
          </p>
          <ul>
            <li><strong>Consultas:</strong> respondemos en máximo 10 días hábiles, prorrogables por 5 días hábiles más avisándote el motivo (artículo 14).</li>
            <li><strong>Reclamos</strong> (corrección, actualización, supresión o revocatoria): respondemos en máximo 15 días hábiles, prorrogables por 8 días hábiles más avisándote el motivo (artículo 15).</li>
          </ul>
        </>
      ),
    },
    {
      id: "menores",
      title: "Menores de edad y datos sensibles",
      body: (
        <p>
          La tienda está dirigida a mayores de 18 años. No pedimos datos sensibles (salud, origen étnico, orientación política o religiosa, datos biométricos, etc.) ni datos de
          menores de edad. Si detectamos que recogimos datos de un menor sin autorización de su representante, los eliminaremos.
        </p>
      ),
    },
    {
      id: "autorizacion",
      title: "Autorización y vigencia",
      body: (
        <p>
          Al crear tu cuenta o hacer un pedido autorizas, de forma previa, expresa e informada, el tratamiento de tus datos según esta política. La política rige desde el {UPDATED}.
          Si cambiamos algo importante, te avisaremos en el sitio o por correo antes de aplicarlo.
        </p>
      ),
    },
  ];
  return (
    <LegalLayout
      title="Política de privacidad"
      intro={<p>Tus datos son tuyos. Aquí te contamos qué información recogemos, para qué la usamos, con quién la compartimos y cómo puedes consultarla, corregirla o eliminarla.</p>}
      sections={sections}
    />
  );
}
