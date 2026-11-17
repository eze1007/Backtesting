import { fromColumns, type Candle, type CandleColumns, type TimeframeId } from "../candles";

/** Scarica (con cache in memoria) le candele di un mese dall'API dell'app. */

const cache = new Map<string, Promise<Candle[]>>();

export class DataError extends Error {}

export function fetchMonth(symbol: string, month: string, tf: TimeframeId): Promise<Candle[]> {
  const key = `${symbol}|${month}|${tf}`;
  let p = cache.get(key);
  if (!p) {
    p = (async () => {
      const res = await fetch(`/api/candles?symbol=${encodeURIComponent(symbol)}&month=${month}&tf=${tf}`);
      const body = (await res.json().catch(() => ({}))) as Partial<CandleColumns> & { error?: string };
      if (!res.ok) throw new DataError(body.error || `Errore nel caricamento dei dati (HTTP ${res.status}).`);
      return fromColumns(body as CandleColumns);
    })();
    cache.set(key, p);
    p.catch(() => cache.delete(key));
  }
  return p;
}

export async function fetchMonths(symbol: string, months: string[], tf: TimeframeId): Promise<Candle[]> {
  const parts = await Promise.all(months.map((m) => fetchMonth(symbol, m, tf)));
  return parts.flat();
}
