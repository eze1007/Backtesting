"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Chart, { type ChartHandle, type ChartLine, type ChartMarker } from "./Chart";
import OrderTicket, { type Ticket, defaultTicket, ticketLevels } from "./OrderTicket";
import PropPanel from "./PropPanel";
import BottomPanel from "./BottomPanel";
import {
  TIMEFRAMES,
  addMonths,
  aggregate,
  bucketStart,
  indexAtOrBefore,
  mergeInto,
  monthKey,
  monthRange,
  tfMinutes,
  type Candle,
  type TimeframeId,
} from "@/lib/candles";
import { conversionSymbol, formatPrice, getInstrument, quoteConversion } from "@/lib/instruments";
import { equityAt, type MarketCtx, type OrderRequest } from "@/lib/engine";
import {
  canTrade,
  sessionCancelOrder,
  sessionClosePosition,
  sessionModifyOrder,
  sessionPlaceOrder,
  sessionStatus,
  stepSession,
  type Drawing,
  type Session,
} from "@/lib/session";
import { loadSession, saveSession } from "@/lib/storage";
import { fetchMonth, fetchMonths } from "@/lib/data/client";

/** Mesi di storico da mostrare prima del replay, in base al timeframe. */
const HISTORY_MONTHS: Record<TimeframeId, number> = { "1m": 1, "5m": 1, "15m": 2, "1h": 3, "4h": 8, "1d": 24 };
/** Quando mancano meno di queste candele da 1 minuto si carica il mese successivo. */
const PREFETCH_BARS = 3000;
const SPEEDS = [
  { ms: 1000, label: "Lenta" },
  { ms: 400, label: "Normale" },
  { ms: 150, label: "Veloce" },
  { ms: 40, label: "Molto veloce" },
];
const STEP_SIZES = [1, 5, 15, 60];

type ClickMode = null | "sl" | "tp" | "price" | "hline" | "trend";

function fmtTime(t: number) {
  return new Date(t * 1000).toISOString().slice(0, 16).replace("T", " ") + " UTC";
}
function money(n: number) {
  return n.toLocaleString("it-IT", { style: "currency", currency: "USD" });
}

export default function Workspace({ id }: { id: string }) {
  const [session, setSessionState] = useState<Session | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [loading, setLoading] = useState<string | null>("Caricamento dei dati…");
  const [dataError, setDataError] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [speedMs, setSpeedMs] = useState(400);
  const [minPerTick, setMinPerTick] = useState(1);
  const [toast, setToast] = useState<string | null>(null);
  const [endOfData, setEndOfData] = useState(false);
  const [clickMode, setClickMode] = useState<ClickMode>(null);
  const [trendStart, setTrendStart] = useState<{ time: number; price: number } | null>(null);
  const [ticket, setTicket] = useState<Ticket>(defaultTicket());
  const [orderError, setOrderError] = useState<string | null>(null);
  const [jumpValue, setJumpValue] = useState("");

  const sessionRef = useRef<Session | null>(null);
  const minuteRef = useRef<Candle[]>([]);
  const minuteMonthsRef = useRef<string[]>([]);
  const historyRef = useRef<Candle[]>([]);
  const aggRef = useRef<Candle[]>([]);
  const idxRef = useRef(-1);
  const convRef = useRef<Candle[]>([]);
  const convMonthsRef = useRef(new Set<string>());
  const loadingNextRef = useRef(false);
  const aheadErrorRef = useRef<string | null>(null);
  const noMoreDataRef = useRef(false);
  const chartRef = useRef<ChartHandle>(null);
  const lastSaveRef = useRef(0);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const inst = useMemo(() => (session ? getInstrument(session.symbol) : null), [session?.symbol]); // eslint-disable-line react-hooks/exhaustive-deps

  const setSession = useCallback((s: Session, forceSave = false) => {
    sessionRef.current = s;
    setSessionState(s);
    const now = Date.now();
    if (forceSave || now - lastSaveRef.current > 2000) {
      saveSession(s);
      lastSaveRef.current = now;
    }
  }, []);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 4500);
  }, []);

  // Contesto di mercato: tasso di conversione in USD.
  const ctx = useMemo<MarketCtx | null>(() => {
    if (!session || !inst) return null;
    const conv = quoteConversion(inst);
    const convClose = (t: number) => {
      const arr = convRef.current;
      if (!arr.length) return NaN;
      const i = indexAtOrBefore(arr, t);
      return arr[Math.max(0, i)].close;
    };
    return {
      inst,
      account: session.account,
      rate: (t, price) => {
        switch (conv.kind) {
          case "identity":
            return 1;
          case "self":
            return 1 / price;
          case "multiply":
            return convClose(t);
          case "divide":
            return 1 / convClose(t);
        }
      },
    };
  }, [session?.account, inst]); // eslint-disable-line react-hooks/exhaustive-deps

  const currentBar = (): Candle | null => (idxRef.current >= 0 ? minuteRef.current[idxRef.current] ?? null : null);

  const loadConversion = useCallback(async (months: string[]) => {
    const s = sessionRef.current;
    if (!s) return;
    const sym = conversionSymbol(getInstrument(s.symbol));
    if (!sym) return;
    const todo = months.filter((m) => !convMonthsRef.current.has(m));
    if (!todo.length) return;
    const bars = await fetchMonths(sym, todo, "1h");
    todo.forEach((m) => convMonthsRef.current.add(m));
    convRef.current = [...convRef.current, ...bars].sort((a, b) => a.time - b.time);
  }, []);

  /** Ricostruisce tutte le candele del grafico (storico + replay) e le passa al grafico. */
  const rebuildChart = useCallback((fit: boolean) => {
    const s = sessionRef.current;
    if (!s) return;
    const minutes = tfMinutes(s.timeframe);
    const firstMonth = minuteMonthsRef.current[0];
    const cut = firstMonth ? monthRange(firstMonth).from : Infinity;
    const hist = historyRef.current.filter((c) => c.time < cut);
    const visible = minuteRef.current.slice(0, idxRef.current + 1);
    aggRef.current = [...hist, ...aggregate(visible, minutes)];
    chartRef.current?.setBars(aggRef.current, fit);
  }, []);

  const loadHistory = useCallback(async (tf: TimeframeId) => {
    const s = sessionRef.current;
    const first = minuteMonthsRef.current[0];
    if (!s || !first) return;
    const n = HISTORY_MONTHS[tf];
    const months = Array.from({ length: n }, (_, i) => addMonths(first, i - n));
    historyRef.current = await fetchMonths(s.symbol, months, tf);
  }, []);

  /** Carica i dati a partire dal mese di `time` e posiziona il cursore. */
  const loadFrom = useCallback(
    async (time: number, cursorTime: number) => {
      const s = sessionRef.current!;
      setLoading("Caricamento dei dati…");
      setDataError(null);
      noMoreDataRef.current = false;
      setEndOfData(false);
      try {
        let month = monthKey(time);
        let bars: Candle[] = [];
        // Salta eventuali mesi senza dati (es. prima dell'inizio dello storico).
        for (let i = 0; i < 4; i++) {
          bars = await fetchMonth(s.symbol, month, "1m");
          if (bars.length || monthRange(month).from > Date.now() / 1000) break;
          month = addMonths(month, 1);
        }
        if (!bars.length) throw new Error("Nessun dato disponibile per questa data.");
        minuteMonthsRef.current = [month];
        minuteRef.current = bars;
        let idx = indexAtOrBefore(bars, cursorTime);
        if (idx < 0) idx = 0;
        idxRef.current = idx;
        await Promise.all([loadHistory(s.timeframe), loadConversion([addMonths(month, -1), month, addMonths(month, 1)])]);
        const next = { ...sessionRef.current!, cursor: bars[idx].time };
        setSession(next, true);
        rebuildChart(true);
        setLoading(null);
      } catch (err) {
        setLoading(null);
        setDataError(err instanceof Error ? err.message : String(err));
      }
    },
    [loadConversion, loadHistory, rebuildChart, setSession],
  );

  // Avvio: legge la sessione e carica i dati.
  useEffect(() => {
    const s = loadSession(id);
    if (!s) {
      setNotFound(true);
      return;
    }
    sessionRef.current = s;
    setSessionState(s);
    const cursorTime = s.cursor ?? s.startTime - 60;
    void loadFrom(s.cursor ?? s.startTime, cursorTime);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // Salvataggio quando si chiude la pagina.
  useEffect(() => {
    const onHide = () => sessionRef.current && saveSession(sessionRef.current);
    window.addEventListener("beforeunload", onHide);
    return () => {
      window.removeEventListener("beforeunload", onHide);
      onHide();
    };
  }, []);

  /** Carica il mese successivo quando ci si avvicina alla fine dei dati caricati. */
  const ensureAhead = useCallback(async () => {
    if (loadingNextRef.current || noMoreDataRef.current) return;
    if (idxRef.current < minuteRef.current.length - PREFETCH_BARS) return;
    const s = sessionRef.current;
    if (!s) return;
    loadingNextRef.current = true;
    try {
      let month = minuteMonthsRef.current[minuteMonthsRef.current.length - 1];
      for (let i = 0; i < 3; i++) {
        month = addMonths(month, 1);
        if (monthRange(month).from > Date.now() / 1000) {
          noMoreDataRef.current = true;
          break;
        }
        const bars = await fetchMonth(s.symbol, month, "1m");
        await loadConversion([month, addMonths(month, 1)]);
        minuteMonthsRef.current.push(month);
        if (bars.length) {
          const last = minuteRef.current[minuteRef.current.length - 1]?.time ?? 0;
          minuteRef.current.push(...bars.filter((b) => b.time > last));
          break;
        }
      }
    } catch (err) {
      aheadErrorRef.current = err instanceof Error ? err.message : String(err);
    } finally {
      loadingNextRef.current = false;
    }
  }, [loadConversion]);

  /**
   * Avanza di `n` candele da 1 minuto (o fino alla condizione `until`).
   * Restituisce false se il replay deve fermarsi.
   */
  const advance = useCallback(
    (n: number, until?: (next: Candle, cur: Candle) => boolean): boolean => {
      let s = sessionRef.current;
      if (!s || !ctx) return false;
      const minutes = tfMinutes(s.timeframe);
      let keepGoing = true;
      let lastMsg: string | null = null;
      let steps = 0;
      while (steps < n) {
        const next = minuteRef.current[idxRef.current + 1];
        const cur = minuteRef.current[idxRef.current];
        if (!next) {
          if (noMoreDataRef.current) {
            setEndOfData(true);
            lastMsg = "Fine dei dati disponibili.";
            keepGoing = false;
          } else if (aheadErrorRef.current) {
            lastMsg = aheadErrorRef.current;
            aheadErrorRef.current = null;
            keepGoing = false;
          }
          // Altrimenti il mese successivo è in caricamento: si riprova al prossimo passo.
          break;
        }
        if (until && cur && until(next, cur)) break;
        idxRef.current += 1;
        steps++;
        const r = stepSession(s, next, ctx);
        s = r.session;
        mergeInto(aggRef.current, next, minutes);
        chartRef.current?.updateBar(aggRef.current[aggRef.current.length - 1]);
        for (const e of r.events) {
          const o = e.order;
          if (e.kind === "filled") lastMsg = `Ordine #${o.id} eseguito a ${formatPrice(ctx.inst, o.openPrice!)}`;
          if (e.kind === "closed") {
            const why = o.closeReason === "tp" ? "Take profit" : o.closeReason === "sl" ? "Stop loss" : "Chiusura";
            lastMsg = `${why} #${o.id}: ${o.pnl >= 0 ? "+" : ""}${money(o.pnl)}`;
          }
        }
        if (r.propAction === "fail") {
          lastMsg = `Sfida fallita. ${s.prop?.state.failReason ?? ""}`;
          keepGoing = false;
          break;
        }
        if (r.propAction === "phase_passed") {
          lastMsg = `Fase superata! Inizia la ${s.prop!.rules.phases[s.prop!.state.phase].name} con il saldo di nuovo a ${money(s.account.initialBalance)}.`;
        }
        if (r.propAction === "passed") {
          lastMsg = "Sfida superata! 🎉";
          keepGoing = false;
          break;
        }
      }
      if (steps > 0 || s !== sessionRef.current) setSession(s, !keepGoing);
      if (lastMsg) showToast(lastMsg);
      void ensureAhead();
      return keepGoing;
    },
    [ctx, ensureAhead, setSession, showToast],
  );

  const stepCandle = useCallback(() => {
    const s = sessionRef.current;
    if (!s) return;
    const minutes = tfMinutes(s.timeframe);
    const sameBucket = (a: Candle, b: Candle) => bucketStart(a.time, minutes) === bucketStart(b.time, minutes);
    const cur = currentBar();
    const next = minuteRef.current[idxRef.current + 1];
    if (cur && next && !sameBucket(cur, next)) {
      // La candela corrente è completa: mostra tutta la successiva.
      if (!advance(1)) return;
    }
    advance(100_000, (n, c) => !sameBucket(n, c));
  }, [advance]);

  // Riproduzione automatica.
  useEffect(() => {
    if (!playing) return;
    const timer = setInterval(() => {
      if (!advance(minPerTick)) setPlaying(false);
    }, speedMs);
    return () => clearInterval(timer);
  }, [playing, speedMs, minPerTick, advance]);

  // Scorciatoie da tastiera.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;
      if (e.code === "Space") {
        e.preventDefault();
        setPlaying((p) => !p);
      } else if (e.code === "ArrowRight") {
        e.preventDefault();
        if (e.shiftKey) advance(1);
        else stepCandle();
      } else if (e.code === "Escape") {
        setClickMode(null);
        setTrendStart(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [advance, stepCandle]);

  const changeTimeframe = useCallback(
    async (tf: TimeframeId) => {
      const s = sessionRef.current;
      if (!s || s.timeframe === tf) return;
      setPlaying(false);
      setSession({ ...s, timeframe: tf }, true);
      setLoading("Caricamento del timeframe…");
      try {
        await loadHistory(tf);
        rebuildChart(true);
      } catch (err) {
        showToast(err instanceof Error ? err.message : String(err));
      } finally {
        setLoading(null);
      }
    },
    [loadHistory, rebuildChart, setSession, showToast],
  );

  const jumpTo = useCallback(async () => {
    const s = sessionRef.current;
    if (!s || !jumpValue) return;
    const t = Date.parse(jumpValue + ":00Z") / 1000;
    const cur = currentBar();
    if (!Number.isFinite(t) || !cur) return;
    if (t <= cur.time) return showToast("Il replay va solo avanti: scegli una data successiva.");
    if (s.engine.orders.some((o) => o.status === "open" || o.status === "pending"))
      return showToast("Chiudi posizioni e ordini pendenti prima di saltare in avanti.");
    setPlaying(false);
    const target = t - 60;
    if (minuteRef.current.length && target <= minuteRef.current[minuteRef.current.length - 1].time) {
      // Il salto è dentro i dati già caricati: si avanza senza mostrare ogni passo.
      idxRef.current = Math.max(idxRef.current, indexAtOrBefore(minuteRef.current, target));
      setSession({ ...s, cursor: minuteRef.current[idxRef.current].time }, true);
      rebuildChart(true);
      void ensureAhead();
      return;
    }
    await loadFrom(t, target);
  }, [jumpValue, loadFrom, rebuildChart, ensureAhead, setSession, showToast]);

  // ---- Ordini ----
  const placeOrder = useCallback(
    (req: OrderRequest) => {
      const s = sessionRef.current;
      const bar = currentBar();
      if (!s || !bar || !ctx) return;
      if (Number.isNaN(ctx.rate(bar.time, bar.close))) return setOrderError("Dati di conversione valuta non ancora caricati, riprova tra un attimo.");
      const r = sessionPlaceOrder(s, req, bar, ctx);
      if (r.error) return setOrderError(r.error);
      setOrderError(null);
      setSession(r.session, true);
      setTicket((t) => ({ ...t, sl: "", tp: "", price: "" }));
    },
    [ctx, setSession],
  );

  const closePos = useCallback(
    (orderId: number) => {
      const s = sessionRef.current;
      const bar = currentBar();
      if (!s || !bar || !ctx) return;
      const before = s.prop?.state.phase;
      const next = sessionClosePosition(s, orderId, bar, ctx);
      setSession(next, true);
      if (next.prop && before !== next.prop.state.phase) showToast("Fase superata! Il saldo riparte dal valore iniziale.");
      if (next.prop?.state.status === "passed") showToast("Sfida superata! 🎉");
    },
    [ctx, setSession, showToast],
  );

  const modify = useCallback(
    (orderId: number, changes: { sl?: number | null; tp?: number | null; price?: number }) => {
      const s = sessionRef.current;
      const bar = currentBar();
      if (!s || !bar || !ctx) return;
      const r = sessionModifyOrder(s, orderId, changes, bar, ctx);
      if (r.error) {
        showToast(r.error);
        setSession({ ...s }, false); // riporta le linee alla posizione precedente
        return;
      }
      setSession(r.session, true);
    },
    [ctx, setSession, showToast],
  );

  const cancel = useCallback(
    (orderId: number) => {
      const s = sessionRef.current;
      if (s) setSession(sessionCancelOrder(s, orderId), true);
    },
    [setSession],
  );

  // ---- Clic sul grafico (SL/TP del ticket, disegni) ----
  const onChartClick = useCallback(
    ({ time, price }: { time: number | null; price: number }) => {
      if (!clickMode || !inst) return;
      const p = price.toFixed(inst.digits);
      if (clickMode === "sl" || clickMode === "tp" || clickMode === "price") {
        setTicket((t) => ({ ...t, [clickMode]: p }));
        setClickMode(null);
        return;
      }
      const s = sessionRef.current;
      if (!s) return;
      if (clickMode === "hline") {
        const d: Drawing = { id: `d${Date.now()}`, kind: "hline", points: [{ time: time ?? 0, price }], color: "#f0b429" };
        setSession({ ...s, drawings: [...s.drawings, d] }, true);
        setClickMode(null);
        return;
      }
      if (clickMode === "trend") {
        if (time == null) return;
        if (!trendStart) {
          setTrendStart({ time, price });
          return;
        }
        if (time === trendStart.time) return;
        const d: Drawing = { id: `d${Date.now()}`, kind: "trend", points: [trendStart, { time, price }], color: "#4c8dff" };
        setSession({ ...s, drawings: [...s.drawings, d] }, true);
        setTrendStart(null);
        setClickMode(null);
      }
    },
    [clickMode, inst, trendStart, setSession],
  );

  // ---- Dati derivati per il grafico ----
  const bar = session ? currentBar() : null;
  const minutes = session ? tfMinutes(session.timeframe) : 1;

  const lines = useMemo<ChartLine[]>(() => {
    if (!session || !inst) return [];
    const out: ChartLine[] = [];
    for (const o of session.engine.orders) {
      if (o.status !== "open" && o.status !== "pending") continue;
      const label = `#${o.id} ${o.side === "buy" ? "BUY" : "SELL"} ${o.lots}`;
      if (o.status === "open") out.push({ key: `e${o.id}`, price: o.openPrice!, color: "#4c8dff", title: label });
      else out.push({ key: `p${o.id}`, price: o.price, color: "#4c8dff", title: `${label} ${o.type.toUpperCase()}`, dashed: true, onDrag: (p) => modify(o.id, { price: p }) });
      if (o.sl != null) out.push({ key: `sl${o.id}`, price: o.sl, color: "#e5484d", title: `SL #${o.id}`, onDrag: (p) => modify(o.id, { sl: p }) });
      if (o.tp != null) out.push({ key: `tp${o.id}`, price: o.tp, color: "#22b07d", title: `TP #${o.id}`, onDrag: (p) => modify(o.id, { tp: p }) });
    }
    // Anteprima del ticket.
    const lv = ticketLevels(ticket);
    if (lv.price != null && ticket.type !== "market") out.push({ key: "t-price", price: lv.price, color: "#8b95a7", title: "Prezzo", dashed: true, onDrag: (p) => setTicket((t) => ({ ...t, price: p.toFixed(inst.digits) })) });
    if (lv.sl != null) out.push({ key: "t-sl", price: lv.sl, color: "#e5484d", title: "SL nuovo", dashed: true, onDrag: (p) => setTicket((t) => ({ ...t, sl: p.toFixed(inst.digits) })) });
    if (lv.tp != null) out.push({ key: "t-tp", price: lv.tp, color: "#22b07d", title: "TP nuovo", dashed: true, onDrag: (p) => setTicket((t) => ({ ...t, tp: p.toFixed(inst.digits) })) });
    return out;
  }, [session, inst, ticket, modify]);

  const markers = useMemo<ChartMarker[]>(() => {
    if (!session || !bar) return [];
    const firstTime = aggRef.current[0]?.time ?? 0;
    const out: ChartMarker[] = [];
    for (const o of session.engine.orders) {
      if (o.openTime != null) {
        const t = bucketStart(o.openTime - 1, minutes);
        if (t >= firstTime && t <= bar.time)
          out.push({ time: t, position: o.side === "buy" ? "belowBar" : "aboveBar", color: o.side === "buy" ? "#22b07d" : "#e5484d", shape: o.side === "buy" ? "arrowUp" : "arrowDown", text: `#${o.id}` });
      }
      if (o.status === "closed" && o.closeTime != null) {
        const t = bucketStart(o.closeTime - 1, minutes);
        if (t >= firstTime && t <= bar.time)
          out.push({ time: t, position: "inBar", color: o.pnl >= 0 ? "#22b07d" : "#e5484d", shape: "circle", text: `${o.pnl >= 0 ? "+" : ""}${Math.round(o.pnl)}` });
      }
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.engine.orders, session?.timeframe, bar?.time, minutes]);

  if (notFound) {
    return (
      <main className="container">
        <p>Sessione non trovata in questo browser.</p>
        <a href="/">Torna alle sessioni</a>
      </main>
    );
  }
  if (!session || !inst) return <main className="container muted">Caricamento…</main>;

  const status = sessionStatus(session);
  const equity = bar && ctx && !Number.isNaN(ctx.rate(bar.time, bar.close)) ? equityAt(session.engine, bar.close, bar.time + 60, ctx) : session.engine.balance;
  const floating = equity - session.engine.balance;
  const spread = session.account.spreadPips * inst.pipSize;

  return (
    <div className="ws">
      <div className="ws-top">
        <a href="/" className="small">← Sessioni</a>
        <strong>{session.symbol}</strong>
        <span className="muted" data-testid="clock">{bar ? fmtTime(bar.time + 60) : "—"}</span>
        <div className="seg" role="group" aria-label="Timeframe">
          {TIMEFRAMES.map((t) => (
            <button key={t.id} className={session.timeframe === t.id ? "active" : ""} onClick={() => changeTimeframe(t.id)}>
              {t.label}
            </button>
          ))}
        </div>
        <span className="spacer" />
        <button onClick={() => setPlaying((p) => !p)} disabled={!!loading || endOfData || status !== "active"} data-testid="play" title="Spazio">
          {playing ? "❚❚ Pausa" : "▶ Play"}
        </button>
        <button onClick={() => advance(1)} disabled={!!loading || playing} title="Maiusc + →" data-testid="step-minute">+1 min</button>
        <button onClick={stepCandle} disabled={!!loading || playing} title="→" data-testid="step-candle">+1 candela</button>
        <select value={speedMs} onChange={(e) => setSpeedMs(Number(e.target.value))} aria-label="Velocità">
          {SPEEDS.map((s) => (
            <option key={s.ms} value={s.ms}>{s.label}</option>
          ))}
        </select>
        <select value={minPerTick} onChange={(e) => setMinPerTick(Number(e.target.value))} aria-label="Minuti per passo">
          {STEP_SIZES.map((m) => (
            <option key={m} value={m}>{m} min/passo</option>
          ))}
        </select>
        <input type="datetime-local" value={jumpValue} onChange={(e) => setJumpValue(e.target.value)} aria-label="Salta a data (UTC)" style={{ width: 190 }} />
        <button onClick={jumpTo} disabled={!jumpValue || !!loading}>Salta</button>
      </div>

      <div className="ws-main">
        <div className="ws-chart">
          <Chart ref={chartRef} digits={inst.digits} lines={lines} markers={markers} drawings={session.drawings} pendingPoint={trendStart} onChartClick={onChartClick} />
          {(loading || dataError) && (
            <div className="overlay">
              {dataError ? (
                <div>
                  <p className="error">{dataError}</p>
                  <button onClick={() => loadFrom(session.cursor ?? session.startTime, session.cursor ?? session.startTime - 60)}>Riprova</button>
                </div>
              ) : (
                <span className="muted">{loading}</span>
              )}
            </div>
          )}
          {toast && <div className="toast" data-testid="toast">{toast}</div>}
          {clickMode && (
            <div className="toast" style={{ top: "auto", bottom: 12 }}>
              {clickMode === "trend" ? (trendStart ? "Clicca il secondo punto" : "Clicca il primo punto") : "Clicca sul grafico per scegliere il prezzo"} · Esc per annullare
            </div>
          )}
        </div>

        <aside className="ws-side">
          <section>
            <h3>Conto</h3>
            <div className="kv" data-testid="account">
              <span>Saldo</span>
              <span data-testid="balance">{money(session.engine.balance)}</span>
              <span>Equity</span>
              <span>{money(equity)}</span>
              <span>P&amp;L aperto</span>
              <span className={floating >= 0 ? "pos" : "neg"}>{money(floating)}</span>
              <span>Prezzo (bid / ask)</span>
              <span>{bar ? `${formatPrice(inst, bar.close)} / ${formatPrice(inst, bar.close + spread)}` : "—"}</span>
            </div>
          </section>

          {session.prop && <PropPanel session={session} />}

          <OrderTicket
            inst={inst}
            session={session}
            ctx={ctx}
            bar={bar}
            ticket={ticket}
            setTicket={setTicket}
            error={orderError}
            disabled={!canTrade(session) || !!loading}
            onSubmit={placeOrder}
            clickMode={clickMode}
            setClickMode={setClickMode}
          />

          <section>
            <h3>Disegni</h3>
            <div className="row">
              <button className={`small ${clickMode === "hline" ? "active" : ""}`} onClick={() => setClickMode(clickMode === "hline" ? null : "hline")}>Linea orizzontale</button>
              <button className={`small ${clickMode === "trend" ? "active" : ""}`} onClick={() => { setTrendStart(null); setClickMode(clickMode === "trend" ? null : "trend"); }}>Trend line</button>
              <button className="small ghost" disabled={!session.drawings.length} onClick={() => setSession({ ...session, drawings: session.drawings.slice(0, -1) }, true)}>Annulla ultimo</button>
              <button className="small ghost" disabled={!session.drawings.length} onClick={() => setSession({ ...session, drawings: [] }, true)}>Cancella tutti</button>
            </div>
          </section>
          <p className="hint">Scorciatoie: Spazio = play/pausa, → = candela successiva, Maiusc+→ = 1 minuto. Le linee SL, TP e i prezzi degli ordini si possono trascinare sul grafico. Orari in UTC.</p>
        </aside>
      </div>

      <BottomPanel session={session} inst={inst} bar={bar} ctx={ctx} onClose={closePos} onCancel={cancel} onModify={modify} />
    </div>
  );
}
