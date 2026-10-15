import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Icon } from "./Icon";
import { api } from "../lib/api";
import { formatDateTime } from "../lib/format";

interface Notification {
  id: number;
  kind: string;
  title: string;
  body: string;
  link: string | null;
  read: boolean;
  createdAt: string;
}

const KIND_ICON: Record<string, string> = {
  wallet: "wallet",
  low_stock: "package",
  account_expiring: "clock",
  service_expiring: "clock",
  account_issue: "alert",
  account_replaced: "refresh",
  ticket: "headphones",
  ticket_reply: "headphones",
  order_delivered: "check",
  order_paid: "receipt",
  payment_review: "alert",
  topup: "wallet",
};

/** Campana de notificaciones (cliente o administración). Se actualiza cada minuto. */
export function NotificationBell({ scope }: { scope: "user" | "admin" }) {
  const base = scope === "admin" ? "/api/admin/notifications" : "/api/account/notifications";
  const [data, setData] = useState<{ unread: number; items: Notification[] } | null>(null);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  const load = useCallback(() => {
    api.get<{ unread: number; items: Notification[] }>(base).then(setData).catch(() => undefined);
  }, [base]);

  useEffect(() => {
    load();
    const t = setInterval(load, 60_000);
    const onFocus = () => load();
    window.addEventListener("focus", onFocus);
    return () => {
      clearInterval(t);
      window.removeEventListener("focus", onFocus);
    };
  }, [load]);

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  const markRead = async (ids: number[] | "all") => {
    await api.post(`${base}/read`, { ids }).catch(() => undefined);
    load();
  };

  return (
    <div style={{ position: "relative" }} ref={ref}>
      <button className="icon-btn" onClick={() => setOpen((o) => !o)} aria-label={`Notificaciones${data?.unread ? `, ${data.unread} sin leer` : ""}`} aria-expanded={open}>
        <Icon name="bell" />
        {data && data.unread > 0 && <span className="count-dot">{data.unread > 9 ? "9+" : data.unread}</span>}
      </button>
      {open && (
        <div className="menu-pop notif-pop" role="dialog" aria-label="Notificaciones">
          <div className="notif-head">
            <strong>Notificaciones</strong>
            {data && data.unread > 0 && (
              <button className="text-accent" style={{ fontSize: 13, padding: 0 }} onClick={() => markRead("all")}>
                Marcar todo como leído
              </button>
            )}
          </div>
          {!data?.items.length ? (
            <p className="faint" style={{ padding: "16px 10px", fontSize: 13 }}>No tienes notificaciones.</p>
          ) : (
            <ul className="notif-list">
              {data.items.map((n) => (
                <li key={n.id}>
                  <button
                    className={`notif-item${n.read ? "" : " is-unread"}`}
                    onClick={() => {
                      if (!n.read) void markRead([n.id]);
                      setOpen(false);
                      if (n.link) navigate(n.link);
                    }}
                  >
                    <span className="notif-icon">
                      <Icon name={KIND_ICON[n.kind] ?? "bell"} />
                    </span>
                    <span style={{ minWidth: 0, flex: 1 }}>
                      <strong>{n.title}</strong>
                      {n.body && <span className="notif-body">{n.body}</span>}
                      <span className="faint" style={{ fontSize: 11 }}>{formatDateTime(n.createdAt)}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
