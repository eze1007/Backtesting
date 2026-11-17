import { expect, test, type Page } from "@playwright/test";

async function createSession(page: Page, opts: { mode?: "prop" | "free"; date?: string; preset?: string; size?: string; symbol?: string } = {}) {
  await page.goto("/");
  if (opts.mode === "free") await page.getByRole("button", { name: "Conto libero" }).click();
  if (opts.symbol) await page.selectOption("select[name=symbol]", opts.symbol);
  await page.fill("input[name=date]", opts.date ?? "2024-03-05");
  if (opts.preset) await page.selectOption("select[name=preset]", opts.preset);
  if (opts.size) await page.selectOption("select[name=size]", opts.size);
  await page.getByRole("button", { name: "Crea e apri" }).click();
  await page.waitForURL(/\/session\//);
  await expect(page.getByTestId("clock")).toContainText("2024");
}

test("crea una sessione, fa il replay e apre e chiude un'operazione", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await createSession(page, { mode: "free" });
  await expect(page.getByTestId("clock")).toHaveText("2024-03-05 08:00 UTC");

  await page.getByTestId("step-candle").click();
  await expect(page.getByTestId("clock")).toHaveText("2024-03-05 08:15 UTC");
  await page.getByTestId("step-minute").click();
  await expect(page.getByTestId("clock")).toHaveText("2024-03-05 08:16 UTC");

  await page.getByRole("button", { name: "Lotti", exact: true }).click();
  await page.fill("input[name=lots]", "1");
  await page.getByTestId("buy").click();
  await expect(page.getByTestId("positions-table").locator("tbody tr")).toHaveCount(1);

  for (let i = 0; i < 4; i++) await page.getByTestId("step-candle").click();
  await page.getByTestId("close-1").click();
  await page.getByTestId("tab-history").click();
  await expect(page.getByTestId("history-table").locator("tbody tr")).toHaveCount(1);
  await page.getByTestId("tab-stats").click();
  await expect(page.getByTestId("stats")).toContainText("Operazioni");
  expect(errors).toEqual([]);
});

test("la sessione viene salvata e riprende dallo stesso punto", async ({ page }) => {
  await createSession(page, { mode: "free" });
  for (let i = 0; i < 3; i++) await page.getByTestId("step-candle").click();
  const clock = await page.getByTestId("clock").textContent();
  await page.reload();
  await expect(page.getByTestId("clock")).toHaveText(clock!);
  await page.goto("/");
  await expect(page.getByTestId("sessions-table").locator("tbody tr")).toHaveCount(1);
});

test("rischio in percentuale con stop loss e take profit", async ({ page }) => {
  await createSession(page, { mode: "free" });
  const bid = Number((await page.getByTestId("account").textContent())!.match(/(\d\.\d{5}) \//)![1]);
  await page.fill("input[name=riskPct]", "1");
  await page.fill("input[name=sl]", (bid - 0.002).toFixed(5));
  await page.fill("input[name=tp]", (bid + 0.004).toFixed(5));
  await expect(page.getByTestId("order-ticket")).toContainText("lotti");
  await page.getByTestId("buy").click();
  await expect(page.getByTestId("order-error")).toHaveCount(0);
  await expect(page.getByTestId("positions-table").locator("tbody tr")).toHaveCount(1);
});

test("le 4 prop firm sono disponibili e una sfida fallisce oltre la perdita giornaliera", async ({ page }) => {
  await page.goto("/");
  const options = await page.locator("select[name=preset] option").allTextContents();
  for (const firm of ["FTMO", "The5ers", "FundedNext", "Funding Pips"]) expect(options.join("|")).toContain(firm);

  await createSession(page, { preset: "ftmo-2step", size: "10000" });
  await expect(page.getByTestId("prop-status")).toHaveText("Fase 1");
  await page.getByRole("button", { name: "Lotti", exact: true }).click();
  await page.fill("input[name=lots]", "50");
  await page.getByTestId("sell").click();
  await page.getByTestId("buy").click();
  // Con 100 lotti esposti su un conto da 10.000 USD la perdita giornaliera viene superata in fretta.
  await page.getByTestId("play").click();
  await expect(page.getByTestId("prop-status")).toHaveText("Fallita", { timeout: 30_000 });
  await expect(page.getByTestId("prop-panel")).toContainText("Perdita");
  await expect(page.getByTestId("buy")).toBeDisabled();

  await page.goto("/");
  await expect(page.getByText("Nuovo tentativo")).toBeVisible();
});

test("crypto e cambio di timeframe", async ({ page }) => {
  await createSession(page, { mode: "free", symbol: "BTCUSDT" });
  await page.getByRole("button", { name: "4H" }).click();
  await expect(page.getByTestId("clock")).toHaveText("2024-03-05 08:00 UTC");
  await page.getByTestId("step-candle").click();
  await expect(page.getByTestId("clock")).toHaveText("2024-03-05 12:00 UTC");
});

test("sfida futures con perdita massima trailing (Topstep)", async ({ page }) => {
  await createSession(page, { preset: "topstep-combine", size: "50000" });
  await expect(page.getByTestId("prop-status")).toHaveText("Combine");
  await expect(page.getByTestId("prop-panel")).toContainText("trailing fine giornata");
  await expect(page.getByTestId("max-floor")).toContainText("48.000");
  await expect(page.getByTestId("prop-panel")).toContainText("Giorno migliore");
});
