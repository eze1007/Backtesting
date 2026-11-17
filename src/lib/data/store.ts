import { gunzipSync } from "node:zlib";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { decodeYear, yearFileName, type RawCandle, type YearFile } from "./format";
import { demoCandles } from "./demo";
import { fetchBinanceApiRange, fetchBinanceArchiveMonth } from "./binance";
import { monthRange } from "../candles";
import type { Instrument } from "../instruments";

/**
 * Accesso ai dati storici lato server.
 *
 * Ordine delle fonti:
 * 1. DATA_SOURCE=demo → dati sintetici (sviluppo e test);
 * 2. file annuali preparati dalla pipeline (GitHub Release "data-v1" o DATA_BASE_URL),
 *    salvati in una cache su disco;
 * 3. per le crypto, se il file annuale non c'è o non copre il mese, Binance in diretta.
 */

export const DEFAULT_DATA_BASE_URL = "https://github.com/eze1007/backtesting/releases/download/data-v1";

export class DataUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DataUnavailableError";
  }
}

function dataBaseUrl() {
  return process.env.DATA_BASE_URL || DEFAULT_DATA_BASE_URL;
}

function cacheDir() {
  return process.env.DATA_CACHE_DIR || path.join(os.tmpdir(), "backtesting-cache");
}

export function isDemo() {
  return process.env.DATA_SOURCE === "demo";
}

const currentYear = () => new Date().getUTCFullYear();

// Cache in memoria degli anni decodificati (pochi, sono grandi).
const yearMemo = new Map<string, { at: number; candles: RawCandle[] | null }>();
const MEMO_MAX = 4;
const CURRENT_YEAR_TTL_MS = 6 * 3600_000;

async function readYear(inst: Instrument, year: number): Promise<RawCandle[] | null> {
  const key = `${inst.symbol}-${year}`;
  const memo = yearMemo.get(key);
  const isCurrent = year >= currentYear();
  if (memo && (!isCurrent || Date.now() - memo.at < CURRENT_YEAR_TTL_MS)) {
    yearMemo.delete(key);
    yearMemo.set(key, memo);
    return memo.candles;
  }

  const file = path.join(cacheDir(), yearFileName(inst.symbol, year));
  let buf: Buffer | null = null;
  try {
    const st = await fs.stat(file);
    if (!isCurrent || Date.now() - st.mtimeMs < CURRENT_YEAR_TTL_MS) buf = await fs.readFile(file);
  } catch {
    /* non in cache */
  }
  if (!buf) {
    const url = `${dataBaseUrl()}/${yearFileName(inst.symbol, year)}`;
    const res = await fetch(url, { cache: "no-store" });
    if (res.status === 404) {
      buf = null;
    } else if (!res.ok) {
      throw new DataUnavailableError(`Download dei dati ${inst.symbol} ${year} non riuscito (HTTP ${res.status}).`);
    } else {
      buf = Buffer.from(await res.arrayBuffer());
      try {
        await fs.mkdir(cacheDir(), { recursive: true });
        await fs.writeFile(file, buf);
      } catch {
        /* la cache su disco è facoltativa */
      }
    }
  }
  const candles = buf ? decodeYear(JSON.parse(gunzipSync(buf).toString("utf8")) as YearFile) : null;
  yearMemo.set(key, { at: Date.now(), candles });
  while (yearMemo.size > MEMO_MAX) yearMemo.delete(yearMemo.keys().next().value as string);
  return candles;
}

function sliceRange(candles: RawCandle[], from: number, to: number): RawCandle[] {
  let lo = 0;
  let hi = candles.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (candles[mid].time < from) lo = mid + 1;
    else hi = mid;
  }
  const out: RawCandle[] = [];
  for (let i = lo; i < candles.length && candles[i].time < to; i++) out.push(candles[i]);
  return out;
}

const liveMemo = new Map<string, { at: number; candles: RawCandle[] }>();

async function liveCrypto(inst: Instrument, month: string, from: number, to: number): Promise<RawCandle[]> {
  const key = `${inst.symbol}-${month}`;
  const isCurrentMonth = to * 1000 > Date.now();
  const memo = liveMemo.get(key);
  if (memo && (!isCurrentMonth || Date.now() - memo.at < 10 * 60_000)) return memo.candles;
  let candles = isCurrentMonth ? null : await fetchBinanceArchiveMonth(inst.sourceId, month);
  if (!candles) candles = await fetchBinanceApiRange(inst.sourceId, from, Math.min(to, Math.floor(Date.now() / 1000)));
  liveMemo.set(key, { at: Date.now(), candles });
  if (liveMemo.size > 24) liveMemo.delete(liveMemo.keys().next().value as string);
  return candles;
}

/** Candele a 1 minuto del mese `month` (YYYY-MM). */
export async function getMonthCandles(inst: Instrument, month: string): Promise<RawCandle[]> {
  const { from, to } = monthRange(month);
  const now = Math.floor(Date.now() / 1000);
  if (from > now) return [];
  if (isDemo()) return demoCandles(inst, from, Math.min(to, now));

  const year = Number(month.slice(0, 4));
  if (year < inst.startYear) return [];
  const yearData = await readYear(inst, year);
  const slice = yearData ? sliceRange(yearData, from, to) : [];

  if (inst.source === "binance") {
    // Il file annuale può non coprire ancora le ultime settimane: completiamo con Binance.
    const lastHave = slice.length ? slice[slice.length - 1].time : null;
    const monthComplete = lastHave != null && to - lastHave <= 3600;
    if (!monthComplete) {
      const live = await liveCrypto(inst, month, from, to);
      if (live.length >= slice.length) return live;
    }
    return slice;
  }

  if (!yearData) {
    throw new DataUnavailableError(
      `I dati di ${inst.symbol} per il ${year} non sono ancora stati preparati. Avvia il workflow "Dati storici" su GitHub Actions.`,
    );
  }
  return slice;
}
