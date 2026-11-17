/** Una candela. `time` è l'apertura della candela in secondi Unix (UTC). */
export interface Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

/** Formato compatto a colonne usato dall'API. */
export interface CandleColumns {
  t: number[];
  o: number[];
  h: number[];
  l: number[];
  c: number[];
  v: number[];
}

export const TIMEFRAMES = [
  { id: "1m", label: "1m", minutes: 1 },
  { id: "5m", label: "5m", minutes: 5 },
  { id: "15m", label: "15m", minutes: 15 },
  { id: "1h", label: "1H", minutes: 60 },
  { id: "4h", label: "4H", minutes: 240 },
  { id: "1d", label: "1D", minutes: 1440 },
] as const;

export type TimeframeId = (typeof TIMEFRAMES)[number]["id"];

export function tfMinutes(tf: TimeframeId): number {
  const found = TIMEFRAMES.find((t) => t.id === tf);
  if (!found) throw new Error(`Timeframe sconosciuto: ${tf}`);
  return found.minutes;
}

export function isTimeframe(v: string): v is TimeframeId {
  return TIMEFRAMES.some((t) => t.id === v);
}

/** Inizio del bucket del timeframe che contiene `time` (allineato a UTC). */
export function bucketStart(time: number, minutes: number): number {
  const size = minutes * 60;
  return Math.floor(time / size) * size;
}

/**
 * Aggrega candele ordinate di timeframe inferiore in candele di `minutes` minuti.
 * L'ultima candela può essere parziale: è così che si forma la candela "in corso" durante il replay.
 */
export function aggregate(candles: Candle[], minutes: number): Candle[] {
  if (minutes <= 1) return candles.slice();
  const out: Candle[] = [];
  let cur: Candle | null = null;
  for (const c of candles) {
    const b = bucketStart(c.time, minutes);
    if (!cur || cur.time !== b) {
      cur = { time: b, open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume };
      out.push(cur);
    } else {
      if (c.high > cur.high) cur.high = c.high;
      if (c.low < cur.low) cur.low = c.low;
      cur.close = c.close;
      cur.volume += c.volume;
    }
  }
  return out;
}

/** Aggiunge una candela di dettaglio all'ultima candela aggregata (aggiornamento incrementale). */
export function mergeInto(agg: Candle[], c: Candle, minutes: number): Candle[] {
  const b = bucketStart(c.time, minutes);
  const last = agg[agg.length - 1];
  if (last && last.time === b) {
    const updated: Candle = {
      time: b,
      open: last.open,
      high: Math.max(last.high, c.high),
      low: Math.min(last.low, c.low),
      close: c.close,
      volume: last.volume + c.volume,
    };
    agg[agg.length - 1] = updated;
  } else {
    agg.push({ ...c, time: b });
  }
  return agg;
}

export function toColumns(candles: Candle[]): CandleColumns {
  const cols: CandleColumns = { t: [], o: [], h: [], l: [], c: [], v: [] };
  for (const k of candles) {
    cols.t.push(k.time);
    cols.o.push(k.open);
    cols.h.push(k.high);
    cols.l.push(k.low);
    cols.c.push(k.close);
    cols.v.push(k.volume);
  }
  return cols;
}

export function fromColumns(cols: CandleColumns): Candle[] {
  const out: Candle[] = new Array(cols.t.length);
  for (let i = 0; i < cols.t.length; i++) {
    out[i] = { time: cols.t[i], open: cols.o[i], high: cols.h[i], low: cols.l[i], close: cols.c[i], volume: cols.v[i] };
  }
  return out;
}

/** Indice dell'ultima candela con `time <= t`, oppure -1. */
export function indexAtOrBefore(candles: { time: number }[], t: number): number {
  let lo = 0;
  let hi = candles.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (candles[mid].time <= t) {
      ans = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return ans;
}

/** Chiave del mese "YYYY-MM" per un timestamp in secondi. */
export function monthKey(time: number): string {
  const d = new Date(time * 1000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function addMonths(key: string, n: number): string {
  const [y, m] = key.split("-").map(Number);
  const total = y * 12 + (m - 1) + n;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  return `${ny}-${String(nm).padStart(2, "0")}`;
}

export function monthRange(key: string): { from: number; to: number } {
  const [y, m] = key.split("-").map(Number);
  const from = Date.UTC(y, m - 1, 1) / 1000;
  const to = Date.UTC(y, m, 1) / 1000;
  return { from, to };
}

export function isMonthKey(v: string): boolean {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(v);
}
