import { Link, useParams } from "react-router-dom";
import { Icon } from "../components/Icon";
import { PrivacyPage, TermsPage } from "./Legal";
import { Empty, ErrorState, Skeleton } from "../components/ui";
import { api } from "../lib/api";
import { formatDate } from "../lib/format";
import { useDocumentTitle, useQuery } from "../lib/hooks";
import { useSession, useStore } from "../lib/state";

interface PostSummary { slug: string; title: string; excerpt: string; publishedAt: string }

export function BlogPage() {
  useDocumentTitle("Blog");
  const q = useQuery(() => api.get<{ items: PostSummary[] }>("/api/catalog/posts"));
  return (
    <div className="container" style={{ maxWidth: 880 }}>
      <div className="page-head">
        <h1 className="page-title">Blog</h1>
        <p className="eyebrow">Guías, novedades e ideas de regalo.</p>
      </div>
      {q.error ? <ErrorState message={q.error.message} onRetry={q.reload} /> : q.loading ? <Skeleton h={200} r={12} /> : !q.data?.items.length ? (
        <Empty icon="book" title="Aún no hay artículos" />
      ) : (
        <div className="order-list">
          {q.data.items.map((p) => (
            <Link key={p.slug} to={`/blog/${p.slug}`} className="order-card" style={{ transition: "border-color .2s" }}>
              <span className="faint" style={{ fontSize: 12 }}>{formatDate(p.publishedAt)}</span>
              <h2 style={{ fontSize: "var(--fs-lg)" }}>{p.title}</h2>
              <p className="muted">{p.excerpt}</p>
              <span className="text-accent" style={{ fontSize: 14, fontWeight: 650 }}>Leer artículo →</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

export function BlogPostPage() {
  const { slug = "" } = useParams();
  const q = useQuery(() => api.get<{ post: PostSummary & { body: string } }>(`/api/catalog/posts/${encodeURIComponent(slug)}`), [slug]);
  useDocumentTitle(q.data?.post.title ?? "Blog");
  if (q.error?.status === 404) return <div className="container"><Empty icon="book" title="Artículo no encontrado" action={<Link className="btn btn-primary" to="/blog">Ver blog</Link>} /></div>;
  if (q.error) return <div className="container"><ErrorState message={q.error.message} onRetry={q.reload} /></div>;
  if (!q.data) return <div className="container section"><Skeleton h={300} /></div>;
  const p = q.data.post;
  return (
    <article className="container" style={{ maxWidth: 760 }}>
      <div className="page-head">
        <nav className="crumbs"><Link to="/blog">Blog</Link><span aria-hidden>›</span><span>{formatDate(p.publishedAt)}</span></nav>
        <h1 className="page-title">{p.title}</h1>
        <p className="eyebrow">{p.excerpt}</p>
      </div>
      {/* El contenido se renderiza como texto (React escapa HTML): sin riesgo de XSS. */}
      <div style={{ display: "grid", gap: 16, fontSize: "var(--fs-md)" }}>
        {p.body.split(/\n{2,}/).map((para, i) => <p key={i} className="prose">{para}</p>)}
      </div>
    </article>
  );
}

const FAQ = [
  { q: "¿Cuándo recibo mi producto?", a: "Cuando la pasarela confirma tu pago, preparamos la entrega. La verás en Mis pedidos → Ver detalle cuando el pedido esté «Completado»." },
  { q: "¿Qué métodos de pago aceptan?", a: "Los métodos habilitados aparecen en el paso de pago. Los pagos se procesan en la pasarela; NexiStore nunca almacena datos de tarjetas." },
  { q: "¿Puedo cancelar un pedido?", a: "Sí, mientras esté pendiente de pago puedes cancelarlo desde el detalle del pedido. Si ya pagaste, escríbenos." },
  { q: "¿Qué cubre la garantía?", a: "Garantizamos el funcionamiento durante todo el periodo contratado. Si algo falla, abre una solicitud y lo resolvemos o te devolvemos el dinero." },
];

export function PublicSupportPage() {
  useDocumentTitle("Soporte");
  const { user } = useSession();
  const store = useStore();
  return (
    <div className="container" style={{ maxWidth: 880 }}>
      <div className="page-head">
        <h1 className="page-title">Centro de soporte</h1>
        <p className="eyebrow">Respuestas rápidas y atención personalizada.</p>
      </div>
      <div className="panel">
        {FAQ.map((f, i) => (
          <details key={f.q} className="acc" open={i === 0}>
            <summary><Icon name="info" />{f.q}<Icon name="chevron-down" className="chev" /></summary>
            <div className="acc-body">{f.a}</div>
          </details>
        ))}
      </div>
      <div className="promo" style={{ marginTop: 24, gridTemplateColumns: "1fr" }}>
        <div>
          <h2>¿Necesitas ayuda con un pedido?</h2>
          <p>Crea una solicitud desde tu cuenta y te responderemos allí mismo{store?.store.supportEmail ? `, o escríbenos a ${store.store.supportEmail}` : ""}.</p>
          <Link className="btn btn-light" to={user ? "/cuenta/soporte" : "/ingresar?next=/cuenta/soporte"}>Crear solicitud</Link>
        </div>
      </div>
    </div>
  );
}

export function LegalPage({ kind }: { kind: "terms" | "privacy" }) {
  return kind === "terms" ? <TermsPage /> : <PrivacyPage />;
}

export function NotFoundPage() {
  useDocumentTitle("Página no encontrada");
  return (
    <div className="container">
      <Empty icon="search" title="Página no encontrada" text="El enlace puede estar roto o la página fue movida." action={<Link className="btn btn-primary" to="/">Ir al inicio</Link>} />
    </div>
  );
}
