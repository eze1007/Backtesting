import { NextResponse } from "next/server";
import { aggregate, isMonthKey, isTimeframe, monthRange, tfMinutes, toColumns } from "@/lib/candles";
import { findInstrument } from "@/lib/instruments";
import { DataUnavailableError, getMonthCandles, isDemo } from "@/lib/data/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/candles?symbol=EURUSD&month=2019-03&tf=1m
 * Restituisce le candele del mese in formato a colonne, aggregate al timeframe richiesto.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const symbol = (url.searchParams.get("symbol") || "").toUpperCase();
  const month = url.searchParams.get("month") || "";
  const tf = url.searchParams.get("tf") || "1m";

  const inst = findInstrument(symbol);
  if (!inst) return NextResponse.json({ error: `Strumento sconosciuto: ${symbol}` }, { status: 400 });
  if (!isMonthKey(month)) return NextResponse.json({ error: "Parametro month non valido (usa YYYY-MM)." }, { status: 400 });
  if (!isTimeframe(tf)) return NextResponse.json({ error: "Timeframe non valido." }, { status: 400 });

  try {
    const candles = await getMonthCandles(inst, month);
    const cols = toColumns(aggregate(candles, tfMinutes(tf)));
    const complete = monthRange(month).to * 1000 < Date.now() - 7 * 86400_000;
    const cache = complete && !isDemo() ? "public, max-age=86400, s-maxage=31536000, immutable" : "public, max-age=300";
    return NextResponse.json({ symbol, month, tf, demo: isDemo(), ...cols }, { headers: { "Cache-Control": cache } });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const status = err instanceof DataUnavailableError ? 404 : 502;
    return NextResponse.json({ error: message }, { status });
  }
}
