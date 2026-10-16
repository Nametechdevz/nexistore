import { useEffect } from "react";

/**
 * Efectos del estilo «Premium»:
 * - aparición de secciones y tarjetas al hacer scroll (con escalonado),
 * - barra de progreso de lectura y cabecera de cristal al bajar,
 * - brillo que sigue al cursor en las tarjetas (`.pcard`, `.glow-card`).
 * Todo se desactiva con «reducir movimiento» del sistema.
 */

const REVEAL = "[data-reveal], .p-grid > *, .p-row > *, .cat-grid > *, .section-head, .trust-item, .bento > *, .steps-pro > *";

export function usePremiumEffects(enabled: boolean, routeKey: string) {
  useEffect(() => {
    if (!enabled) return;
    const root = document.documentElement;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    // --- Aparición al hacer scroll ---
    const io = reduced
      ? null
      : new IntersectionObserver(
          (entries) => {
            for (const e of entries) {
              if (!e.isIntersecting) continue;
              e.target.classList.add("is-in");
              io!.unobserve(e.target);
            }
          },
          { rootMargin: "0px 0px -8% 0px", threshold: 0.08 },
        );
    const prepare = (el: Element) => {
      if (!(el instanceof HTMLElement) || el.dataset.revealed) return;
      el.dataset.revealed = "1";
      if (!io) return;
      const r = el.getBoundingClientRect();
      // Lo que ya se ve al cargar no se oculta (evita parpadeos).
      if (r.top < window.innerHeight * 0.92) return;
      const siblings = el.parentElement ? Array.from(el.parentElement.children) : [];
      el.style.setProperty("--i", String(Math.min(siblings.indexOf(el), 8)));
      el.classList.add("reveal");
      io.observe(el);
    };
    const scan = (node: ParentNode) => node.querySelectorAll(REVEAL).forEach(prepare);
    const main = document.getElementById("main");
    if (main) scan(main);
    const mo = new MutationObserver((muts) => {
      for (const m of muts) m.addedNodes.forEach((n) => n instanceof HTMLElement && (n.matches(REVEAL) ? prepare(n) : scan(n)));
    });
    if (main) mo.observe(main, { childList: true, subtree: true });

    // --- Progreso de scroll y cabecera ---
    let ticking = false;
    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        const max = document.documentElement.scrollHeight - window.innerHeight;
        root.style.setProperty("--scroll", String(max > 0 ? Math.min(window.scrollY / max, 1) : 0));
        root.classList.toggle("is-scrolled", window.scrollY > 12);
        ticking = false;
      });
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });

    // --- Brillo que sigue al cursor ---
    const onMove = (e: PointerEvent) => {
      const card = (e.target as Element | null)?.closest?.(".pcard, .glow-card") as HTMLElement | null;
      if (!card) return;
      const r = card.getBoundingClientRect();
      card.style.setProperty("--mx", `${e.clientX - r.left}px`);
      card.style.setProperty("--my", `${e.clientY - r.top}px`);
    };
    if (!reduced) document.addEventListener("pointermove", onMove, { passive: true });

    return () => {
      io?.disconnect();
      mo.disconnect();
      window.removeEventListener("scroll", onScroll);
      document.removeEventListener("pointermove", onMove);
      root.classList.remove("is-scrolled");
    };
  }, [enabled, routeKey]);
}

/** Inclinación 3D según la posición del cursor (portada premium). */
export function useTilt(ref: React.RefObject<HTMLElement | null>, enabled: boolean) {
  useEffect(() => {
    const el = ref.current;
    if (!el || !enabled || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const onMove = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      el.style.setProperty("--rx", `${((e.clientY - r.top) / r.height - 0.5) * -10}deg`);
      el.style.setProperty("--ry", `${((e.clientX - r.left) / r.width - 0.5) * 14}deg`);
    };
    const reset = () => {
      el.style.setProperty("--rx", "0deg");
      el.style.setProperty("--ry", "0deg");
    };
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerleave", reset);
    return () => {
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerleave", reset);
    };
  }, [ref, enabled]);
}

/** Cuenta hacia arriba cuando el número entra en pantalla. */
export function countUp(el: HTMLElement, to: number, suffix = "") {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    el.textContent = `${to.toLocaleString("es-CO")}${suffix}`;
    return () => undefined;
  }
  let raf = 0;
  const io = new IntersectionObserver(([e]) => {
    if (!e?.isIntersecting) return;
    io.disconnect();
    const start = performance.now();
    const tick = (t: number) => {
      const p = Math.min((t - start) / 1200, 1);
      const eased = 1 - (1 - p) ** 3;
      el.textContent = `${Math.round(to * eased).toLocaleString("es-CO")}${suffix}`;
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
  });
  io.observe(el);
  return () => {
    io.disconnect();
    cancelAnimationFrame(raf);
  };
}
