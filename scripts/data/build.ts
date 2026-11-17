/**
 * Pipeline dei dati storici.
 *
 * Scarica le candele a 1 minuto e scrive un file compresso per strumento e anno
 * (formato descritto in src/lib/data/format.ts).
 *
 * Uso:
 *   npx tsx scripts/data/build.ts --symbols EURUSD,XAUUSD --from 2010 --to 2026 --out data-out [--skip EURUSD-2010,...]
 *
 * Forex e oro: Dukascopy (dukascopy-node). Crypto: archivi mensili pubblici di Binance.
 */
import { gzipSync } from "node:zlib";
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { encodeYear, yearFileName, type RawCandle } from "../../src/lib/data/format";
import { fetchBinanceApiRange, fetchBinanceArchiveMonth } from "../../src/lib/data/binance";
import { getInstrument, INSTRUMENTS, type Instrument } from "../../src/lib/instruments";

function arg(name: string, def?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : def;
}

const nowYear = new Date().getUTCFullYear();
const symbolsArg = arg("symbols", "all")!;
const symbols = symbolsArg === "all" ? INSTRUMENTS.map((i) => i.symbol) : symbolsArg.split(",").map((s) => s.trim().toUpperCase());
const fromYear = Number(arg("from", "2010"));
const toYear = Number(arg("to", String(nowYear)));
const outDir = arg("out", "data-out")!;
const skip = new Set((arg("skip", "") || "").split(",").filter(Boolean));
const chromePath = process.env.CHROME_PATH || undefined;

mkdirSync(outDir, { recursive: true });

function months(year: number): { key: string; from: Date; to: Date }[] {
  const out = [];
  for (let m = 0; m < 12; m++) {
    const from = new Date(Date.UTC(year, m, 1));
    if (from.getTime() > Date.now()) break;
    const to = new Date(Math.min(Date.UTC(year, m + 1, 1), Date.now()));
    out.push({ key: `${year}-${String(m + 1).padStart(2, "0")}`, from, to });
  }
  return out;
}

async function sleep(ms: number) {
  await new Promise((r) => setTimeout(r, ms));
}

async function dukascopyMonth(inst: Instrument, from: Date, to: Date): Promise<RawCandle[]> {
  const { getHistoricalRates } = await import("dukascopy-node");
  for (let attempt = 1; ; attempt++) {
    try {
      const rows = (await getHistoricalRates({
        instrument: inst.sourceId as never,
        dates: { from, to },
        timeframe: "m1",
        priceType: "bid",
        format: "array",
        volumes: true,
        ignoreFlats: true,
        batchSize: 10,
        pauseBetweenBatchesMs: 300,
        retryCount: 5,
        pauseBetweenRetriesMs: 2000,
        ...(chromePath ? { chromePath } : {}),
      })) as unknown as number[][];
      return rows.map((r) => ({ time: Math.floor(r[0] / 1000), open: r[1], high: r[2], low: r[3], close: r[4], volume: r[5] ?? 0 }));
    } catch (err) {
      if (attempt >= 3) throw err;
      console.warn(`  tentativo ${attempt} fallito, riprovo:`, (err as Error).message);
      await sleep(5000 * attempt);
    }
  }
}

async function binanceMonth(inst: Instrument, key: string, from: Date, to: Date): Promise<RawCandle[]> {
  const archived = await fetchBinanceArchiveMonth(inst.sourceId, key);
  if (archived) return archived;
  // Mese in corso o archivio non ancora pubblicato.
  return fetchBinanceApiRange(inst.sourceId, from.getTime() / 1000, to.getTime() / 1000);
}

async function buildYear(inst: Instrument, year: number) {
  const name = yearFileName(inst.symbol, year);
  const file = path.join(outDir, name);
  if (skip.has(`${inst.symbol}-${year}`) || existsSync(file)) {
    console.log(`- ${name}: già presente, salto`);
    return;
  }
  const all: RawCandle[] = [];
  for (const m of months(year)) {
    const t = Date.now();
    const rows = inst.source === "binance" ? await binanceMonth(inst, m.key, m.from, m.to) : await dukascopyMonth(inst, m.from, m.to);
    const lo = m.from.getTime() / 1000;
    const hi = m.to.getTime() / 1000;
    for (const r of rows) if (r.time >= lo && r.time < hi) all.push(r);
    console.log(`  ${inst.symbol} ${m.key}: ${rows.length} candele (${((Date.now() - t) / 1000).toFixed(1)}s)`);
  }
  if (!all.length) {
    console.log(`- ${name}: nessun dato, file non creato`);
    return;
  }
  const encoded = encodeYear(inst.symbol, year, inst.digits, all);
  const gz = gzipSync(JSON.stringify(encoded), { level: 9 });
  writeFileSync(file, gz);
  console.log(`✓ ${name}: ${encoded.dt.length} candele, ${(gz.length / 1024).toFixed(0)} KB`);
}

async function main() {
  for (const s of symbols) {
    const inst = getInstrument(s);
    const start = Math.max(fromYear, inst.startYear);
    for (let y = start; y <= toYear; y++) await buildYear(inst, y);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
