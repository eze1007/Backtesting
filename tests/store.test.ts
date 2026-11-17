import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { gzipSync } from "node:zlib";
import os from "node:os";
import path from "node:path";
import { encodeYear, yearFileName } from "@/lib/data/format";
import { demoCandles } from "@/lib/data/demo";
import { getInstrument } from "@/lib/instruments";

let dir: string;

beforeAll(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), "bt-store-"));
  process.env.DATA_CACHE_DIR = dir;
  delete process.env.DATA_SOURCE;
  const inst = getInstrument("EURUSD");
  const from = Date.UTC(2019, 0, 1) / 1000;
  const candles = demoCandles(inst, from, Date.UTC(2019, 3, 1) / 1000);
  writeFileSync(path.join(dir, yearFileName("EURUSD", 2019)), gzipSync(JSON.stringify(encodeYear("EURUSD", 2019, inst.digits, candles))));
});

afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("archivio dati lato server", () => {
  it("legge un mese dal file annuale in cache", async () => {
    const { getMonthCandles } = await import("@/lib/data/store");
    const feb = await getMonthCandles(getInstrument("EURUSD"), "2019-02");
    expect(feb.length).toBeGreaterThan(20 * 24 * 60 * 0.9);
    expect(feb[0].time).toBeGreaterThanOrEqual(Date.UTC(2019, 1, 1) / 1000);
    expect(feb[feb.length - 1].time).toBeLessThan(Date.UTC(2019, 2, 1) / 1000);
  });

  it("dà un errore chiaro se l'anno non è stato preparato", async () => {
    const { getMonthCandles, DataUnavailableError } = await import("@/lib/data/store");
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("not found", { status: 404 }));
    await expect(getMonthCandles(getInstrument("GBPUSD"), "2015-05")).rejects.toBeInstanceOf(DataUnavailableError);
    expect(fetchMock.mock.calls[0][0]).toContain("/GBPUSD-2015.json.gz");
    fetchMock.mockRestore();
  });

  it("per le crypto senza file annuale usa Binance", async () => {
    const { getMonthCandles } = await import("@/lib/data/store");
    const { zipSync, strToU8 } = await import("fflate");
    const csv = "1704067200000,1,2,0.5,1.5,10\n1704067260000,1.5,2,1,1.2,5\n";
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      const u = String(url);
      if (u.includes("data.binance.vision")) return new Response(new Blob([zipSync({ "a.csv": strToU8(csv) }) as BlobPart]));
      return new Response("not found", { status: 404 });
    });
    const rows = await getMonthCandles(getInstrument("BTCUSDT"), "2024-01");
    expect(rows).toHaveLength(2);
    fetchMock.mockRestore();
  });
});
