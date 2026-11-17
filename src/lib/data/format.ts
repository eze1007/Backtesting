/**
 * Formato compatto dei file annuali di candele a 1 minuto ("SIMBOLO-ANNO.json.gz").
 *
 * I prezzi sono salvati come interi (prezzo × scale) e codificati per differenza:
 *  - dt: minuti trascorsi dalla candela precedente (la prima è relativa a t0)
 *  - o:  apertura − chiusura precedente
 *  - c:  chiusura − apertura
 *  - h:  massimo − max(apertura, chiusura)
 *  - l:  min(apertura, chiusura) − minimo
 *  - vol: volume arrotondato a 2 decimali
 * Così i numeri sono piccoli e il file compresso pesa poco.
 *
 * Questo modulo non importa nulla, così può essere usato sia dall'app sia dagli script della pipeline.
 */

export interface RawCandle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface YearFile {
  v: 1;
  symbol: string;
  year: number;
  scale: number;
  t0: number;
  dt: number[];
  o: number[];
  h: number[];
  l: number[];
  c: number[];
  vol: number[];
}

export function encodeYear(symbol: string, year: number, digits: number, candles: RawCandle[]): YearFile {
  const scale = Math.pow(10, digits);
  const sorted = [...candles].sort((a, b) => a.time - b.time);
  const file: YearFile = { v: 1, symbol, year, scale, t0: sorted.length ? sorted[0].time : 0, dt: [], o: [], h: [], l: [], c: [], vol: [] };
  let prevT = file.t0;
  let prevC = 0;
  let lastTime = -1;
  for (const k of sorted) {
    if (k.time === lastTime) continue; // duplicati
    lastTime = k.time;
    const o = Math.round(k.open * scale);
    const c = Math.round(k.close * scale);
    const h = Math.max(Math.round(k.high * scale), o, c);
    const l = Math.min(Math.round(k.low * scale), o, c);
    file.dt.push(Math.round((k.time - prevT) / 60));
    file.o.push(o - prevC);
    file.c.push(c - o);
    file.h.push(h - Math.max(o, c));
    file.l.push(Math.min(o, c) - l);
    file.vol.push(Math.round(k.volume * 100) / 100);
    prevT = k.time;
    prevC = c;
  }
  return file;
}

export function decodeYear(file: YearFile): RawCandle[] {
  if (file.v !== 1) throw new Error(`Versione del file dati non supportata: ${file.v}`);
  const n = file.dt.length;
  const out: RawCandle[] = new Array(n);
  let t = file.t0;
  let prevC = 0;
  const s = file.scale;
  for (let i = 0; i < n; i++) {
    t += file.dt[i] * 60;
    const o = prevC + file.o[i];
    const c = o + file.c[i];
    const h = Math.max(o, c) + file.h[i];
    const l = Math.min(o, c) - file.l[i];
    out[i] = { time: t, open: o / s, high: h / s, low: l / s, close: c / s, volume: file.vol[i] };
    prevC = c;
  }
  return out;
}

export function yearFileName(symbol: string, year: number): string {
  return `${symbol}-${year}.json.gz`;
}
