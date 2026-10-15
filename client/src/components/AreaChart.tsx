import { useMemo, useRef, useState } from "react";
import { formatCOP } from "../lib/format";

const W = 640;
const H = 240;
const PAD = { l: 52, r: 12, t: 16, b: 28 };

function niceMax(v: number) {
  if (v <= 0) return 100_000;
  const pow = 10 ** Math.floor(Math.log10(v));
  return Math.ceil(v / pow) * pow;
}

const shortCOP = (v: number) => (v >= 1_000_000 ? `${(v / 1_000_000).toFixed(1).replace(".0", "")}M` : v >= 1000 ? `${Math.round(v / 1000)}k` : String(v));

/** Gráfico de área de ventas (SVG accesible, sin dependencias). */
export function AreaChart({ data, labelFor }: { data: { day: string; total: number; orders: number }[]; labelFor: (day: string) => string }) {
  const [hover, setHover] = useState<number | null>(null);
  const ref = useRef<SVGSVGElement>(null);
  const max = niceMax(Math.max(...data.map((d) => d.total), 0));
  const iw = W - PAD.l - PAD.r;
  const ih = H - PAD.t - PAD.b;
  const x = (i: number) => PAD.l + (data.length <= 1 ? iw / 2 : (i * iw) / (data.length - 1));
  const y = (v: number) => PAD.t + ih - (v / max) * ih;

  const { line, area } = useMemo(() => {
    if (!data.length) return { line: "", area: "" };
    const pts = data.map((d, i) => [x(i), y(d.total)] as const);
    // Curva suave (Catmull-Rom → Bézier).
    let path = `M${pts[0]![0]},${pts[0]![1]}`;
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[i - 1] ?? pts[i]!;
      const p1 = pts[i]!;
      const p2 = pts[i + 1]!;
      const p3 = pts[i + 2] ?? p2;
      const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
      const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
      path += ` C${c1[0]},${Math.min(c1[1]!, PAD.t + ih)} ${c2[0]},${Math.min(c2[1]!, PAD.t + ih)} ${p2[0]},${p2[1]}`;
    }
    return { line: path, area: `${path} L${x(data.length - 1)},${PAD.t + ih} L${x(0)},${PAD.t + ih} Z` };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, max]);

  const step = data.length > 10 ? Math.ceil(data.length / 7) : 1;
  const total = data.reduce((s, d) => s + d.total, 0);

  return (
    <div style={{ position: "relative" }}>
      <svg
        ref={ref}
        className="chart"
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={`Ventas del periodo: ${formatCOP(total)}`}
        onMouseLeave={() => setHover(null)}
        onMouseMove={(e) => {
          const rect = ref.current!.getBoundingClientRect();
          const px = ((e.clientX - rect.left) / rect.width) * W;
          const i = Math.round(((px - PAD.l) / iw) * (data.length - 1));
          setHover(Math.max(0, Math.min(data.length - 1, i)));
        }}
      >
        <defs>
          <linearGradient id="area-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#e3122c" stopOpacity="0.45" />
            <stop offset="100%" stopColor="#e3122c" stopOpacity="0" />
          </linearGradient>
        </defs>
        {[0, 0.25, 0.5, 0.75, 1].map((t) => (
          <g key={t}>
            <line className="grid-line" x1={PAD.l} x2={W - PAD.r} y1={y(max * t)} y2={y(max * t)} />
            <text x={PAD.l - 8} y={y(max * t) + 4} textAnchor="end">{shortCOP(max * t)}</text>
          </g>
        ))}
        <path d={area} fill="url(#area-fill)" />
        <path d={line} fill="none" stroke="#ff2b43" strokeWidth="2.5" vectorEffect="non-scaling-stroke" />
        {data.map((d, i) =>
          i % step === 0 || i === data.length - 1 ? (
            <text key={d.day} x={x(i)} y={H - 8} textAnchor="middle">{labelFor(d.day)}</text>
          ) : null,
        )}
        {hover !== null && (
          <>
            <line x1={x(hover)} x2={x(hover)} y1={PAD.t} y2={PAD.t + ih} stroke="rgba(255,255,255,.2)" />
            <circle cx={x(hover)} cy={y(data[hover]!.total)} r="5" fill="#ff2b43" stroke="#08090c" strokeWidth="2" />
          </>
        )}
      </svg>
      {hover !== null && data[hover] && (
        <div className="chart-tip" style={{ left: `${(x(hover) / W) * 100}%`, top: `${(y(data[hover]!.total) / H) * 100}%` }}>
          <strong className="num">{formatCOP(data[hover]!.total)}</strong>
          <div className="faint">{labelFor(data[hover]!.day)} · {data[hover]!.orders} pedido{data[hover]!.orders === 1 ? "" : "s"}</div>
        </div>
      )}
    </div>
  );
}
