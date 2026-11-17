"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import {
  ColorType,
  CrosshairMode,
  LineStyle,
  createChart,
  type IChartApi,
  type IPriceLine,
  type ISeriesApi,
  type SeriesMarker,
  type Time,
  type UTCTimestamp,
} from "lightweight-charts";
import type { Candle } from "@/lib/candles";
import type { Drawing } from "@/lib/session";

export interface ChartLine {
  key: string;
  price: number;
  color: string;
  title: string;
  dashed?: boolean;
  /** Se presente la linea si può trascinare; riceve il nuovo prezzo al rilascio. */
  onDrag?: (price: number) => void;
}

export interface ChartMarker {
  time: number;
  position: "aboveBar" | "belowBar" | "inBar";
  color: string;
  shape: "arrowUp" | "arrowDown" | "circle" | "square";
  text?: string;
}

export interface ChartHandle {
  setBars: (bars: Candle[], fit?: boolean) => void;
  updateBar: (bar: Candle) => void;
}

interface Props {
  digits: number;
  lines: ChartLine[];
  markers: ChartMarker[];
  drawings: Drawing[];
  /** Punto in attesa del secondo clic per una trend line. */
  pendingPoint?: { time: number; price: number } | null;
  onChartClick?: (p: { time: number | null; price: number }) => void;
}

const toBar = (c: Candle) => ({ time: c.time as UTCTimestamp, open: c.open, high: c.high, low: c.low, close: c.close });

const Chart = forwardRef<ChartHandle, Props>(function Chart({ digits, lines, markers, drawings, pendingPoint, onChartClick }, ref) {
  const hostRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const priceLines = useRef(new Map<string, IPriceLine>());
  const linesRef = useRef<ChartLine[]>(lines);
  const drawingSeries = useRef(new Map<string, ISeriesApi<"Line">>());
  const drawingLines = useRef(new Map<string, IPriceLine>());
  const clickRef = useRef(onChartClick);
  const lastBarTime = useRef<number | null>(null);

  linesRef.current = lines;
  clickRef.current = onChartClick;

  useEffect(() => {
    const host = hostRef.current!;
    const chart = createChart(host, {
      autoSize: true,
      layout: { background: { type: ColorType.Solid, color: "#0f1218" }, textColor: "#c7cdd8", fontSize: 12 },
      grid: { vertLines: { color: "#1a2130" }, horzLines: { color: "#1a2130" } },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: { borderColor: "#283142" },
      timeScale: { borderColor: "#283142", timeVisible: true, secondsVisible: false, rightOffset: 12 },
    });
    const series = chart.addCandlestickSeries({
      upColor: "#22b07d",
      downColor: "#e5484d",
      wickUpColor: "#22b07d",
      wickDownColor: "#e5484d",
      borderVisible: false,
      priceFormat: { type: "price", precision: digits, minMove: Math.pow(10, -digits) },
    });
    chartRef.current = chart;
    seriesRef.current = series;

    chart.subscribeClick((param) => {
      if (!param.point || !clickRef.current) return;
      const price = series.coordinateToPrice(param.point.y);
      if (price == null) return;
      const t = (param.time as number | undefined) ?? (chart.timeScale().coordinateToTime(param.point.x) as number | null) ?? null;
      clickRef.current({ time: t, price });
    });

    // Trascinamento delle linee di prezzo (SL, TP, prezzo degli ordini pendenti).
    let dragging: { line: ChartLine; pl: IPriceLine } | null = null;
    const yOf = (e: MouseEvent) => e.clientY - host.getBoundingClientRect().top;
    const near = (y: number) => {
      for (const l of linesRef.current) {
        if (!l.onDrag) continue;
        const ly = series.priceToCoordinate(l.price);
        if (ly != null && Math.abs(ly - y) <= 6) return l;
      }
      return null;
    };
    const onDown = (e: MouseEvent) => {
      const l = near(yOf(e));
      const pl = l && priceLines.current.get(l.key);
      if (!l || !pl) return;
      dragging = { line: l, pl };
      chart.applyOptions({ handleScroll: false, handleScale: false });
      e.preventDefault();
      e.stopPropagation();
    };
    const onMove = (e: MouseEvent) => {
      const y = yOf(e);
      if (dragging) {
        const p = series.coordinateToPrice(y);
        if (p != null) dragging.pl.applyOptions({ price: p });
        return;
      }
      host.style.cursor = near(y) ? "ns-resize" : "";
    };
    const onUp = (e: MouseEvent) => {
      if (!dragging) return;
      const p = series.coordinateToPrice(yOf(e));
      const { line } = dragging;
      dragging = null;
      chart.applyOptions({ handleScroll: true, handleScale: true });
      if (p != null) line.onDrag?.(Number(p.toFixed(digits)));
    };
    host.addEventListener("mousedown", onDown, true);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);

    return () => {
      host.removeEventListener("mousedown", onDown, true);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
      priceLines.current.clear();
      drawingSeries.current.clear();
      drawingLines.current.clear();
    };
  }, [digits]);

  useImperativeHandle(ref, () => ({
    setBars(bars, fit) {
      const s = seriesRef.current;
      if (!s) return;
      s.setData(bars.map(toBar));
      lastBarTime.current = bars.length ? bars[bars.length - 1].time : null;
      if (fit && bars.length) {
        const ts = chartRef.current!.timeScale();
        const n = bars.length;
        ts.setVisibleLogicalRange({ from: Math.max(0, n - 150), to: n + 12 });
      }
    },
    updateBar(bar) {
      const s = seriesRef.current;
      if (!s) return;
      if (lastBarTime.current != null && bar.time < lastBarTime.current) return;
      s.update(toBar(bar));
      lastBarTime.current = bar.time;
    },
  }));

  // Linee di prezzo: crea, aggiorna o rimuove.
  useEffect(() => {
    const s = seriesRef.current;
    if (!s) return;
    const seen = new Set<string>();
    for (const l of lines) {
      seen.add(l.key);
      const opts = {
        price: l.price,
        color: l.color,
        title: l.title,
        lineWidth: 1 as const,
        lineStyle: l.dashed ? LineStyle.Dashed : LineStyle.Solid,
        axisLabelVisible: true,
      };
      const existing = priceLines.current.get(l.key);
      if (existing) existing.applyOptions(opts);
      else priceLines.current.set(l.key, s.createPriceLine(opts));
    }
    for (const [k, pl] of priceLines.current) {
      if (!seen.has(k)) {
        s.removePriceLine(pl);
        priceLines.current.delete(k);
      }
    }
  }, [lines]);

  useEffect(() => {
    const s = seriesRef.current;
    if (!s) return;
    const sorted = [...markers].sort((a, b) => a.time - b.time);
    s.setMarkers(sorted.map((m) => ({ ...m, time: m.time as Time })) as SeriesMarker<Time>[]);
  }, [markers]);

  // Disegni: linee orizzontali come price line, trend line come serie a due punti.
  useEffect(() => {
    const chart = chartRef.current;
    const s = seriesRef.current;
    if (!chart || !s) return;
    const all = pendingPoint ? [...drawings, { id: "__pending", kind: "hline" as const, points: [pendingPoint], color: "#8b95a7" }] : drawings;
    const seen = new Set<string>();
    for (const d of all) {
      seen.add(d.id);
      if (d.kind === "hline") {
        if (!drawingLines.current.has(d.id)) {
          drawingLines.current.set(
            d.id,
            s.createPriceLine({ price: d.points[0].price, color: d.color, lineWidth: 1, lineStyle: d.id === "__pending" ? LineStyle.Dotted : LineStyle.Solid, axisLabelVisible: false, title: "" }),
          );
        } else {
          drawingLines.current.get(d.id)!.applyOptions({ price: d.points[0].price });
        }
      } else if (!drawingSeries.current.has(d.id)) {
        const pts = [...d.points].sort((a, b) => a.time - b.time);
        if (pts.length < 2 || pts[0].time === pts[1].time) continue;
        const ls = chart.addLineSeries({ color: d.color, lineWidth: 2, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
        ls.setData(pts.map((p) => ({ time: p.time as UTCTimestamp, value: p.price })));
        drawingSeries.current.set(d.id, ls);
      }
    }
    for (const [k, pl] of drawingLines.current) {
      if (!seen.has(k)) {
        s.removePriceLine(pl);
        drawingLines.current.delete(k);
      }
    }
    for (const [k, ls] of drawingSeries.current) {
      if (!seen.has(k)) {
        chart.removeSeries(ls);
        drawingSeries.current.delete(k);
      }
    }
  }, [drawings, pendingPoint]);

  return <div ref={hostRef} className="chart-host" data-testid="chart" />;
});

export default Chart;
