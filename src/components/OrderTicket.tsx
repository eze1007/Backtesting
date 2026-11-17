"use client";

import type { Candle } from "@/lib/candles";
import { lotsForRisk, spreadOf, type MarketCtx, type OrderRequest, type OrderType, type Side } from "@/lib/engine";
import type { Instrument } from "@/lib/instruments";
import type { Session } from "@/lib/session";

export interface Ticket {
  side: Side;
  type: OrderType;
  sizeMode: "lots" | "risk";
  lots: string;
  riskPct: string;
  price: string;
  sl: string;
  tp: string;
}

export function defaultTicket(): Ticket {
  return { side: "buy", type: "market", sizeMode: "risk", lots: "0.10", riskPct: "1", price: "", sl: "", tp: "" };
}

const num = (s: string) => {
  const n = Number(String(s).replace(",", "."));
  return s.trim() === "" || !Number.isFinite(n) ? null : n;
};

export function ticketLevels(t: Ticket) {
  return { price: num(t.price), sl: num(t.sl), tp: num(t.tp) };
}

function money(n: number) {
  return n.toLocaleString("it-IT", { style: "currency", currency: "USD" });
}

interface Props {
  inst: Instrument;
  session: Session;
  ctx: MarketCtx | null;
  bar: Candle | null;
  ticket: Ticket;
  setTicket: (fn: (t: Ticket) => Ticket) => void;
  error: string | null;
  disabled: boolean;
  onSubmit: (req: OrderRequest) => void;
  clickMode: string | null;
  setClickMode: (m: null | "sl" | "tp" | "price") => void;
}

export default function OrderTicket({ inst, session, ctx, bar, ticket, setTicket, error, disabled, onSubmit, clickMode, setClickMode }: Props) {
  const set = (k: keyof Ticket, v: string) => setTicket((t) => ({ ...t, [k]: v }));
  const lv = ticketLevels(ticket);
  const spread = ctx ? spreadOf(ctx) : 0;
  const entry = (side: Side) => (ticket.type === "market" ? (bar ? (side === "buy" ? bar.close + spread : bar.close) : null) : lv.price);

  function computeLots(side: Side): { lots: number | null; risk: number | null; note?: string } {
    if (!ctx || !bar) return { lots: null, risk: null };
    const e = entry(side);
    if (ticket.sizeMode === "lots") {
      const lots = num(ticket.lots);
      const risk = lots != null && lv.sl != null && e != null ? Math.abs(e - lv.sl) * lots * inst.contractSize * ctx.rate(bar.time, e) : null;
      return { lots, risk };
    }
    const pct = num(ticket.riskPct);
    if (lv.sl == null || e == null || pct == null) return { lots: null, risk: null, note: "Con il rischio in % serve lo stop loss." };
    const lots = lotsForRisk(session.engine.balance, pct, Math.abs(e - lv.sl), e, bar.time, ctx);
    if (lots < inst.minLot) return { lots: null, risk: null, note: "Stop troppo largo per questo rischio: la dimensione scende sotto il minimo." };
    return { lots, risk: Math.abs(e - lv.sl) * lots * inst.contractSize * ctx.rate(bar.time, e) };
  }

  function submit(side: Side) {
    const { lots } = computeLots(side);
    if (lots == null) return;
    onSubmit({ side, type: ticket.type, lots, price: lv.price ?? undefined, sl: lv.sl, tp: lv.tp });
  }

  const preview = computeLots(ticket.side);
  const pips = (a: number | null, b: number | null) => (a != null && b != null ? (Math.abs(a - b) / inst.pipSize).toFixed(1) : null);
  const e = entry(ticket.side);
  const step = Math.pow(10, -inst.digits);

  return (
    <section data-testid="order-ticket">
      <h3>Nuovo ordine</h3>
      <div className="grid" style={{ gap: 8 }}>
        <div className="seg" role="group" aria-label="Tipo di ordine">
          {(["market", "limit", "stop"] as const).map((t) => (
            <button key={t} type="button" className={ticket.type === t ? "active" : ""} onClick={() => set("type", t)}>
              {t === "market" ? "Mercato" : t === "limit" ? "Limit" : "Stop"}
            </button>
          ))}
        </div>
        {ticket.type !== "market" && (
          <label>
            Prezzo di ingresso
            <div className="row">
              <input style={{ flex: 1 }} type="number" step={step} value={ticket.price} onChange={(ev) => set("price", ev.target.value)} name="price" />
              <button type="button" className={`small ${clickMode === "price" ? "active" : ""}`} onClick={() => setClickMode(clickMode === "price" ? null : "price")}>Dal grafico</button>
            </div>
          </label>
        )}
        <div className="seg" role="group" aria-label="Dimensione">
          <button type="button" className={ticket.sizeMode === "risk" ? "active" : ""} onClick={() => set("sizeMode", "risk")}>Rischio %</button>
          <button type="button" className={ticket.sizeMode === "lots" ? "active" : ""} onClick={() => set("sizeMode", "lots")}>Lotti</button>
        </div>
        {ticket.sizeMode === "risk" ? (
          <label>
            Rischio (% del saldo)
            <input type="number" step={0.1} min={0.01} value={ticket.riskPct} onChange={(ev) => set("riskPct", ev.target.value)} name="riskPct" />
          </label>
        ) : (
          <label>
            Lotti
            <input type="number" step={inst.lotStep} min={inst.minLot} value={ticket.lots} onChange={(ev) => set("lots", ev.target.value)} name="lots" />
          </label>
        )}
        <label>
          Stop loss {pips(e, lv.sl) && <span>({pips(e, lv.sl)} pip)</span>}
          <div className="row">
            <input style={{ flex: 1 }} type="number" step={step} value={ticket.sl} onChange={(ev) => set("sl", ev.target.value)} name="sl" />
            <button type="button" className={`small ${clickMode === "sl" ? "active" : ""}`} onClick={() => setClickMode(clickMode === "sl" ? null : "sl")}>Dal grafico</button>
          </div>
        </label>
        <label>
          Take profit {pips(e, lv.tp) && <span>({pips(e, lv.tp)} pip)</span>}
          <div className="row">
            <input style={{ flex: 1 }} type="number" step={step} value={ticket.tp} onChange={(ev) => set("tp", ev.target.value)} name="tp" />
            <button type="button" className={`small ${clickMode === "tp" ? "active" : ""}`} onClick={() => setClickMode(clickMode === "tp" ? null : "tp")}>Dal grafico</button>
          </div>
        </label>
        <div className="hint">
          {preview.lots != null ? `${preview.lots} lotti` : preview.note ?? ""}
          {preview.risk != null ? ` · rischio ${money(preview.risk)}` : ""}
          {lv.sl != null && lv.tp != null && e != null ? ` · R:R 1:${(Math.abs(lv.tp - e) / Math.abs(e - lv.sl)).toFixed(2)}` : ""}
        </div>
        <div className="grid grid-2">
          <button type="button" className="buy" disabled={disabled || computeLots("buy").lots == null} onClick={() => submit("buy")} data-testid="buy">
            Compra
          </button>
          <button type="button" className="sell" disabled={disabled || computeLots("sell").lots == null} onClick={() => submit("sell")} data-testid="sell">
            Vendi
          </button>
        </div>
        {error && <div className="error" data-testid="order-error">{error}</div>}
      </div>
    </section>
  );
}
