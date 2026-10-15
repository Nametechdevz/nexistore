import { Link } from "react-router-dom";
import { Icon } from "./Icon";
import { Price, ProductArt } from "./ui";
import { discountPercent } from "../lib/format";
import { useCart, useToast } from "../lib/state";
import type { ProductSummary } from "../../../shared/types";

export function ProductCard({ p, ribbon }: { p: ProductSummary; ribbon?: boolean }) {
  const cart = useCart();
  const toast = useToast();
  const off = discountPercent(p.price, p.compareAtPrice);
  const inCart = cart.lines.find((l) => l.productId === p.id)?.quantity ?? 0;
  const soldOut = p.stock <= 0;
  const atLimit = inCart >= Math.min(p.maxPerOrder, p.stock);

  return (
    <article className="pcard">
      <Link to={`/producto/${p.slug}`} className="pcard-media" aria-label={p.name}>
        <ProductArt glyph={p.artGlyph} color={p.artColor} name={p.name.split(" ")[0]} imageUrl={p.imageUrl} ribbon={ribbon} />
        {off > 0 && <span className="badge-off">-{off}%</span>}
      </Link>
      <div className="pcard-body">
        <h3 className="pcard-name">
          <Link to={`/producto/${p.slug}`}>{p.name}</Link>
        </h3>
        <p className="pcard-meta">{p.summary}</p>
        <Price price={p.price} compareAt={p.compareAtPrice} />
        {soldOut ? (
          <p className="stock-out">Agotado</p>
        ) : p.stock <= 5 ? (
          <p className="stock-low">Últimas {p.stock} unidades</p>
        ) : null}
        <div style={{ marginTop: "auto" }}>
          <button
            className="btn btn-primary btn-sm btn-block"
            disabled={soldOut || atLimit}
            onClick={() => {
              cart.add(p.id, 1, Math.min(p.maxPerOrder, p.stock));
              toast("success", `${p.name} se agregó al carrito.`);
            }}
          >
            <Icon name="cart" />
            {soldOut ? "Agotado" : atLimit ? "Máximo en carrito" : "Comprar"}
          </button>
        </div>
      </div>
    </article>
  );
}
