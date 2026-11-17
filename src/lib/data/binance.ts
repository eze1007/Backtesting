import { unzipSync, strFromU8 } from "fflate";
import type { RawCandle } from "./format";

/**
 * Dati crypto da Binance, senza chiavi API:
 * - mesi conclusi: archivi mensili pubblici su data.binance.vision;
 * - mese in corso: endpoint pubblico di sola lettura data-api.binance.vision.
 */

const ARCHIVE = "https://data.binance.vision/data/spot/monthly/klines";
const API = "https://data-api.binance.vision/api/v3/klines";

/** I timestamp degli archivi spot dal 2025 sono in microsecondi: li normalizziamo a secondi. */
export function toSeconds(ts: number): number {
  if (ts > 1e14) return Math.floor(ts / 1e6);
  if (ts > 1e11) return Math.floor(ts / 1e3);
  return ts;
}

export function parseKlinesCsv(csv: string): RawCandle[] {
  const out: RawCandle[] = [];
  for (const line of csv.split(/\r?\n/)) {
    if (!line || !/^\d/.test(line)) continue; // salta righe vuote e intestazioni
    const p = line.split(",");
    out.push({
      time: toSeconds(Number(p[0])),
      open: Number(p[1]),
      high: Number(p[2]),
      low: Number(p[3]),
      close: Number(p[4]),
      volume: Number(p[5]),
    });
  }
  return out;
}

export function parseMonthlyZip(zip: Uint8Array): RawCandle[] {
  const files = unzipSync(zip);
  const name = Object.keys(files).find((n) => n.endsWith(".csv"));
  if (!name) throw new Error("Archivio Binance senza CSV");
  return parseKlinesCsv(strFromU8(files[name]));
}

export async function fetchBinanceArchiveMonth(symbol: string, month: string, fetchImpl: typeof fetch = fetch): Promise<RawCandle[] | null> {
  const url = `${ARCHIVE}/${symbol}/1m/${symbol}-1m-${month}.zip`;
  const res = await fetchImpl(url);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Binance archivio ${month}: HTTP ${res.status}`);
  return parseMonthlyZip(new Uint8Array(await res.arrayBuffer()));
}

/** Scarica le candele 1m tra `from` e `to` (secondi) dall'API pubblica, 1000 alla volta. */
export async function fetchBinanceApiRange(symbol: string, from: number, to: number, fetchImpl: typeof fetch = fetch): Promise<RawCandle[]> {
  const out: RawCandle[] = [];
  let start = from * 1000;
  const end = to * 1000 - 1;
  for (let guard = 0; guard < 100 && start <= end; guard++) {
    const url = `${API}?symbol=${symbol}&interval=1m&limit=1000&startTime=${start}&endTime=${end}`;
    const res = await fetchImpl(url);
    if (!res.ok) throw new Error(`Binance API: HTTP ${res.status}`);
    const rows = (await res.json()) as [number, string, string, string, string, string][];
    if (!rows.length) break;
    for (const r of rows) {
      out.push({ time: toSeconds(r[0]), open: +r[1], high: +r[2], low: +r[3], close: +r[4], volume: +r[5] });
    }
    start = rows[rows.length - 1][0] + 60_000;
    if (rows.length < 1000) break;
  }
  return out;
}
