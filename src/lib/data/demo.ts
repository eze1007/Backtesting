import type { RawCandle } from "./format";
import type { Instrument } from "../instruments";

/**
 * Dati sintetici deterministici, usati solo quando DATA_SOURCE=demo (sviluppo e test automatici).
 * Il prezzo è una funzione continua del tempo, quindi i mesi si raccordano senza salti.
 */

const BASE: Record<string, number> = {
  EUR: 1.1, GBP: 1.27, AUD: 0.67, NZD: 0.61, USD: 1, CAD: 0.74, CHF: 1.1, JPY: 0.0069,
  XAU: 1900, BTC: 40000, ETH: 2500, BNB: 300, SOL: 100, XRP: 0.55, ADA: 0.45, DOGE: 0.08, LTC: 80,
};

function hash(n: number): number {
  let x = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b);
  x ^= x >>> 13;
  x = Math.imul(x, 0xc2b2ae35);
  x ^= x >>> 16;
  return (x >>> 0) / 4294967296;
}

function seedOf(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

function priceAt(inst: Instrument, minute: number, seed: number): number {
  const quote = inst.quote === "USDT" ? "USD" : inst.quote;
  const base = (BASE[inst.base] ?? 1) / (BASE[quote] ?? 1);
  const vol = inst.category === "crypto" ? 0.25 : inst.category === "metal" ? 0.08 : 0.04;
  const ph = (seed % 1000) / 159;
  const wave =
    0.5 * Math.sin(minute / 43_000 + ph) +
    0.3 * Math.sin(minute / 9_100 + ph * 2) +
    0.15 * Math.sin(minute / 1_300 + ph * 3) +
    0.07 * Math.sin(minute / 170 + ph * 5) +
    0.03 * Math.sin(minute / 23 + ph * 7);
  return base * Math.exp(vol * wave);
}

export function isMarketOpen(inst: Instrument, time: number): boolean {
  if (inst.category === "crypto") return true;
  const d = new Date(time * 1000);
  const day = d.getUTCDay();
  const h = d.getUTCHours();
  if (day === 6) return false;
  if (day === 5 && h >= 22) return false;
  if (day === 0 && h < 22) return false;
  return true;
}

export function demoCandles(inst: Instrument, from: number, to: number): RawCandle[] {
  const seed = seedOf(inst.symbol);
  const out: RawCandle[] = [];
  const scale = Math.pow(10, inst.digits);
  const r = (x: number) => Math.round(x * scale) / scale;
  const noiseAmp = inst.category === "crypto" ? 0.0012 : inst.category === "metal" ? 0.0005 : 0.00025;
  for (let t = from; t < to; t += 60) {
    if (!isMarketOpen(inst, t)) continue;
    const m = Math.floor(t / 60);
    const open = priceAt(inst, m, seed);
    const close = priceAt(inst, m + 1, seed);
    const n1 = hash(m ^ seed);
    const n2 = hash((m * 7) ^ seed);
    const high = Math.max(open, close) * (1 + noiseAmp * n1);
    const low = Math.min(open, close) * (1 - noiseAmp * n2);
    out.push({ time: t, open: r(open), high: r(high), low: r(low), close: r(close), volume: Math.round(100 + 900 * hash(m + seed)) });
  }
  return out;
}
