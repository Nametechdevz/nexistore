import { Router } from "express";
import { z } from "zod";
import { query, queryOne, toIso } from "../db.js";
import { ah, notFound, parse } from "../lib/http.js";
import { getProductBySlug, listCategories, listProducts } from "../services/catalog.js";
import { DEFAULT_CAMPAIGN, DEFAULT_STORE, getSetting } from "../services/settings.js";
import { paymentMethods, UNAVAILABLE_METHODS } from "../payments/index.js";
import { getManualAccounts, publicAccount } from "../services/manual-pay.js";
import { theme } from "../services/theme.js";

export const catalogRouter = Router();

const listQuery = z.object({
  q: z.string().trim().max(80).optional(),
  category: z.string().trim().max(80).regex(/^[a-z0-9-]*$/).optional(),
  minPrice: z.coerce.number().int().min(0).optional(),
  maxPrice: z.coerce.number().int().min(0).optional(),
  onSale: z.enum(["1", "true"]).optional(),
  featured: z.enum(["1", "true"]).optional(),
  sort: z.enum(["popular", "price_asc", "price_desc", "newest", "discount"]).optional(),
  page: z.coerce.number().int().min(1).max(1000).default(1),
  pageSize: z.coerce.number().int().min(1).max(48).default(24),
});

catalogRouter.get(
  "/store",
  ah(async (_req, res) => {
    const [campaign, store] = await Promise.all([getSetting("campaign", DEFAULT_CAMPAIGN), getSetting("store", DEFAULT_STORE)]);
    res.json({
      campaign,
      store: {
        storeName: store.storeName,
        supportEmail: store.supportEmail,
        supportWhatsapp: store.supportWhatsapp,
        manualPaymentInstructions: store.manualPaymentInstructions,
        legalName: store.legalName,
        legalId: store.legalId,
        legalAddress: store.legalAddress,
        legalCity: store.legalCity,
      },
      paymentMethods: await paymentMethods(),
      manualAccounts: (await getManualAccounts()).map(publicAccount),
      theme: theme(),
      unavailableMethods: UNAVAILABLE_METHODS,
    });
  }),
);

catalogRouter.get(
  "/categories",
  ah(async (_req, res) => {
    res.json({ items: await listCategories() });
  }),
);

catalogRouter.get(
  "/products",
  ah(async (req, res) => {
    const q = parse(listQuery, req.query);
    const { items, total } = await listProducts({
      q: q.q || undefined,
      category: q.category || undefined,
      minPrice: q.minPrice,
      maxPrice: q.maxPrice,
      onSale: Boolean(q.onSale),
      featured: Boolean(q.featured),
      sort: q.sort,
      limit: q.pageSize,
      offset: (q.page - 1) * q.pageSize,
    });
    res.json({ items, total, page: q.page, pageSize: q.pageSize });
  }),
);

catalogRouter.get(
  "/products/:slug",
  ah(async (req, res) => {
    const product = await getProductBySlug(String(req.params.slug));
    if (!product) throw notFound("Producto no encontrado.");
    const related = await listProducts({ category: product.categorySlug, limit: 7 });
    res.json({ product, related: related.items.filter((p) => p.id !== product.id).slice(0, 6) });
  }),
);

catalogRouter.get(
  "/posts",
  ah(async (_req, res) => {
    const rows = await query<{ slug: string; title: string; excerpt: string; published_at: Date }>(
      "SELECT slug, title, excerpt, published_at FROM posts WHERE is_published = 1 ORDER BY published_at DESC LIMIT 50",
    );
    res.json({ items: rows.map((r) => ({ slug: r.slug, title: r.title, excerpt: r.excerpt, publishedAt: toIso(r.published_at) })) });
  }),
);

catalogRouter.get(
  "/posts/:slug",
  ah(async (req, res) => {
    const r = await queryOne<{ slug: string; title: string; excerpt: string; body: string; published_at: Date }>(
      "SELECT slug, title, excerpt, body, published_at FROM posts WHERE slug = ? AND is_published = 1",
      [String(req.params.slug)],
    );
    if (!r) throw notFound("Artículo no encontrado.");
    res.json({ post: { slug: r.slug, title: r.title, excerpt: r.excerpt, body: r.body, publishedAt: toIso(r.published_at) } });
  }),
);
