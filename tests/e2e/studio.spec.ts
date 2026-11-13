import { readFile } from "node:fs/promises";
import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
async function editor(page: Page, sql: string) {
  if ((page.viewportSize()?.width ?? 1440) < 768)
    await page
      .getByRole("navigation", { name: "Panel studio" })
      .getByRole("button", { name: "Editor", exact: true })
      .click();
  await page
    .getByRole("textbox", { name: "Editor SQL", exact: true })
    .fill(sql);
}
async function run(page: Page, sql: string) {
  await editor(page, sql);
  await page
    .getByRole("button", { name: "Jalankan pertanyaan", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Jalankan pertanyaan", exact: true }),
  ).toBeEnabled();
}
async function palette(page: Page, label: string) {
  await page.keyboard.press("Control+k");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: label, exact: false })
    .click();
}
async function showResults(page: Page) {
  if ((page.viewportSize()?.width ?? 1440) < 768)
    await page
      .getByRole("navigation", { name: "Panel studio" })
      .getByRole("button", { name: "Hasil", exact: true })
      .click();
}
async function showPlan(page: Page) {
  if ((page.viewportSize()?.width ?? 1440) < 768)
    await page
      .getByRole("navigation", { name: "Panel studio" })
      .getByRole("button", { name: "Pelan", exact: true })
      .click();
  else await page.getByRole("tab", { name: "Pelan", exact: true }).click();
}
test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".result-summary")).toHaveCount(1);
});
test("runs SQL through worker and displays typed values and NULL", async ({
  page,
}) => {
  await run(
    page,
    "SELECT 5.0 / 2 AS nisbah, NULL AS kosong, 'berjaya' AS status;",
  );
  await expect(
    page.getByRole("table", { name: "Hasil pertanyaan" }),
  ).toContainText("2.5");
  await expect(page.locator(".null-value")).toHaveText("NULL");
});
test("keyboard shortcut runs a query", async ({ page }) => {
  await editor(page, "SELECT 42 AS jawapan;");
  await page.keyboard.press("Control+Enter");
  await showResults(page);
  await expect(page.getByRole("table")).toContainText("42");
});
test("shows real plan and step-through changes selection", async ({ page }) => {
  await showPlan(page);
  await expect(
    page.getByRole("heading", { name: "Aliran pelaksanaan" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Langkah pelan", exact: true })
    .click();
  await expect(page.locator(".replay-controls")).toContainText("1 / 6");
  await page
    .getByRole("button", { name: "Main semula pelan", exact: true })
    .click();
  await expect(page.locator(".replay-controls")).toContainText("6 / 6", {
    timeout: 10000,
  });
});
test("syntax error is localized and marked in editor", async ({ page }) => {
  await run(page, "SELECT (1 +");
  await expect(page.getByRole("alert")).toContainText("Baris 1");
  await expect(page.getByRole("alert")).toContainText("Jangkaan");
  if ((page.viewportSize()?.width ?? 1440) < 768)
    await page.getByRole("button", { name: "Editor", exact: true }).click();
  await expect(page.locator(".cm-lintRange-error")).toHaveCount(1);
});
test("runs multiple statements and enforces constraints atomically", async ({
  page,
}) => {
  await run(
    page,
    "CREATE TABLE ujian (id INTEGER PRIMARY KEY, nama TEXT NOT NULL); INSERT INTO ujian VALUES (1,'Satu'); SELECT * FROM ujian;",
  );
  await expect(page.getByRole("table")).toContainText("Satu");
  await run(page, "INSERT INTO ujian VALUES (2,'Dua'),(1,'Duplikat');");
  await expect(page.getByRole("alert")).toContainText("UNIQUE");
  await run(page, "SELECT COUNT(*) AS jumlah FROM ujian;");
  await expect(page.locator("tbody tr")).toHaveCount(1);
  await expect(page.locator("tbody td").nth(1)).toHaveText("1");
});
test("rejects unavailable transaction syntax instead of simulating it", async ({
  page,
}) => {
  await run(page, "BEGIN;");
  await expect(page.getByRole("alert")).toContainText("tidak dijangka");
  await run(page, "SELECT COUNT(*) FROM pelajar;");
  await expect(page.getByRole("table")).toContainText("120");
});
test("executes indexed equality through the Worker and displays its actual trace", async ({
  page,
}) => {
  await run(
    page,
    "CREATE TABLE uji_indeks(id INTEGER PRIMARY KEY,k INTEGER,nama TEXT); INSERT INTO uji_indeks VALUES(1,7,'Satu'),(2,7,'Dua'),(3,NULL,'Kosong'); CREATE INDEX ix_uji ON uji_indeks(k); SELECT id,nama FROM uji_indeks WHERE k=7 ORDER BY id;",
  );
  await showResults(page);
  await expect(page.locator("tbody tr")).toHaveCount(2);
  await expect(page.getByRole("table")).toContainText("Dua");
  await showPlan(page);
  const graph = page.getByRole("group", { name: /Pelan pelaksanaan:/ });
  await expect(graph).toHaveAttribute("aria-label", /Carian indeks/);
  await expect(graph).not.toHaveAttribute("aria-label", /Imbasan jadual/);
  await run(
    page,
    "UPDATE uji_indeks SET k=9 WHERE id=1; DELETE FROM uji_indeks WHERE id=2; INSERT INTO uji_indeks VALUES(4,7,'Empat'); SELECT id,nama FROM uji_indeks WHERE 7=k;",
  );
  await showResults(page);
  await expect(page.locator("tbody tr")).toHaveCount(1);
  await expect(page.getByRole("table")).toContainText("Empat");
  await showPlan(page);
  await expect(graph).toHaveAttribute("aria-label", /Carian indeks/);
});
test("shows table-scan fallback for NULL predicates and dropped indexes", async ({
  page,
}) => {
  await run(
    page,
    "CREATE TABLE uji_fallback(id INTEGER,k INTEGER); INSERT INTO uji_fallback VALUES(1,7),(2,NULL); CREATE INDEX ix_fallback ON uji_fallback(k); SELECT id FROM uji_fallback WHERE k IS NULL;",
  );
  await showResults(page);
  await expect(page.locator("tbody td").nth(1)).toHaveText("2");
  await showPlan(page);
  const graph = page.getByRole("group", { name: /Pelan pelaksanaan:/ });
  await expect(graph).toHaveAttribute("aria-label", /Imbasan jadual/);
  await expect(graph).not.toHaveAttribute("aria-label", /Carian indeks/);
  await run(
    page,
    "DROP INDEX ix_fallback; SELECT id FROM uji_fallback WHERE k=7;",
  );
  await showResults(page);
  await expect(page.locator("tbody td").nth(1)).toHaveText("1");
  await showPlan(page);
  await expect(graph).toHaveAttribute("aria-label", /Imbasan jadual/);
});
test("switches between all three datasets", async ({ page }) => {
  await page.getByLabel("Set data", { exact: true }).selectOption("kedai");
  await showResults(page);
  await expect(page.getByRole("table")).toContainText("nilai_stok");
  await page.getByLabel("Set data", { exact: true }).selectOption("edagang");
  await expect(page.getByRole("table")).toContainText("jumlah_jualan");
  await page.getByLabel("Set data", { exact: true }).selectOption("sekolah");
  await expect(page.getByRole("table")).toContainText("purata_markah");
});
test("imports CSV file with inferred numeric and nullable columns", async ({
  page,
}) => {
  await palette(page, "Import CSV");
  await page.getByLabel("Fail CSV", { exact: true }).setInputFiles({
    name: "contoh.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(
      'nama,markah,aktif\n"Aina, Sofea",90,true\nBala,,false',
    ),
  });
  await page.getByRole("button", { name: "Import data", exact: true }).click();
  await showResults(page);
  await expect(page.getByRole("table")).toContainText("Aina, Sofea");
  await expect(page.locator(".null-value")).toHaveText("NULL");
  await run(page, "SELECT SUM(markah) FROM import_csv_1;");
  await expect(page.getByRole("table")).toContainText("90");
});
test("malformed CSV gives actionable feedback", async ({ page }) => {
  await palette(page, "Import CSV");
  await page.getByLabel("Kandungan CSV").fill("a,b\n1,2,3");
  await page.getByRole("button", { name: "Import data", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(
    page.getByRole("status").filter({ hasText: "Bilangan lajur CSV" }),
  ).toBeVisible();
});
test("saves a snippet in IndexedDB and restores after reload", async ({
  page,
}) => {
  await editor(page, "SELECT 731 AS petikan;");
  await page
    .getByRole("button", { name: "Simpan petikan", exact: true })
    .click();
  await expect(
    page.getByRole("status").filter({ hasText: "Petikan disimpan" }),
  ).toBeVisible();
  await page.reload();
  await expect(page.locator(".result-summary")).toHaveCount(1);
  await palette(page, "Petikan tersimpan");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: /SELECT 731 AS petikan/ })
    .first()
    .click();
  await expect(
    page.getByRole("textbox", { name: "Editor SQL", exact: true }),
  ).toContainText("SELECT 731");
});
test("command palette keyboard navigation and focus return", async ({
  page,
}) => {
  await page
    .getByRole("button", { name: "Cari arahan… ⌘ K", exact: true })
    .click();
  await expect(page.getByLabel("Cari arahan", { exact: true })).toBeFocused();
  await page.getByLabel("Cari arahan", { exact: true }).fill("Sejarah");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("dialog", { name: "Sejarah pertanyaan" }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Cari arahan… ⌘ K", exact: true }),
  ).toBeFocused();
});
test("sorts view and exports CSV and JSON", async ({ page }) => {
  await run(
    page,
    "SELECT id, nama FROM pelajar WHERE id <= 3 ORDER BY id DESC;",
  );
  await page
    .getByRole("columnheader")
    .getByRole("button", { name: /^id/ })
    .click();
  await expect(
    page.locator("tbody tr").first().locator("td").nth(1),
  ).toHaveText("1");
  const csv = page.waitForEvent("download");
  await page.getByRole("button", { name: "Eksport CSV", exact: true }).click();
  const csvDownload = await csv;
  expect(csvDownload.suggestedFilename()).toBe("vela-hasil.csv");
  const csvPath = await csvDownload.path();
  expect(csvPath).not.toBeNull();
  const csvLines = (await readFile(csvPath!, "utf8")).split("\r\n");
  expect(csvLines.slice(1).map((line) => line.split(",")[0])).toEqual([
    '"1"',
    '"2"',
    '"3"',
  ]);
  const json = page.waitForEvent("download");
  await page.getByRole("button", { name: "Eksport JSON", exact: true }).click();
  const jsonDownload = await json;
  expect(jsonDownload.suggestedFilename()).toBe("vela-hasil.json");
  const jsonPath = await jsonDownload.path();
  expect(jsonPath).not.toBeNull();
  const exported: unknown = JSON.parse(await readFile(jsonPath!, "utf8"));
  expect(exported).toEqual({
    columns: ["id", "nama"],
    rows: [
      [1, expect.any(String)],
      [2, expect.any(String)],
      [3, expect.any(String)],
    ],
  });
});
test("comparison uses real SQLite WASM and reports match", async ({ page }) => {
  await showResults(page);
  await page.getByRole("tab", { name: "Banding SQLite", exact: true }).click();
  await page.getByLabel("Aktifkan Banding SQLite").check();
  await run(page, "SELECT id, nama FROM pelajar WHERE id < 4 ORDER BY id;");
  await expect(page.getByText("Hasil sepadan", { exact: true })).toBeVisible({
    timeout: 20000,
  });
});
test("comparison matches empty SELECT results", async ({ page }) => {
  await showResults(page);
  await page.getByRole("tab", { name: "Banding SQLite", exact: true }).click();
  await page.getByLabel("Aktifkan Banding SQLite").check();
  await run(page, "SELECT id FROM pelajar WHERE id < 0;");
  await expect(page.getByText("Hasil sepadan", { exact: true })).toBeVisible({
    timeout: 20000,
  });
});
test("100k results are virtualized and can scroll to the final row", async ({
  page,
}) => {
  test.setTimeout(60000);
  await palette(page, "Jana data ujian");
  await page.getByRole("radio", { name: "100,000 baris", exact: true }).check();
  await page
    .getByRole("button", { name: "Jana 100,000 baris", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Jalankan pertanyaan", exact: true }),
  ).toBeEnabled({ timeout: 30000 });
  await run(page, "SELECT id, nama FROM data_janaan;");
  await expect(page.getByRole("table")).toHaveAttribute(
    "aria-rowcount",
    "100001",
  );
  expect(await page.locator("tbody tr").count()).toBeLessThan(50);
  const layoutShift = await page
    .locator(".table-scroll")
    .evaluate(async (el) => {
      let total = 0;
      const observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          const shift = entry as PerformanceEntry & {
            hadRecentInput: boolean;
            value: number;
          };
          if (!shift.hadRecentInput) total += shift.value;
        }
      });
      observer.observe({ type: "layout-shift" });
      // Exercise virtualization outside the recent-input exclusion window.
      await new Promise<void>((resolve) => setTimeout(resolve, 550));
      for (let step = 0; step < 60; step++) {
        el.scrollTop = (step * (el.scrollHeight - el.clientHeight)) / 59;
        await new Promise<void>((resolve) =>
          requestAnimationFrame(() => resolve()),
        );
      }
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      );
      observer.disconnect();
      return total;
    });
  expect(layoutShift).toBeLessThan(0.1);
  await expect(page.getByRole("table")).toContainText("Rekod 100000");
});
test("guided SELECT lesson checks actual results", async ({ page }) => {
  await palette(page, "Makmal berpandu");
  await page
    .getByRole("button", { name: "Buka dalam editor", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Jalankan pertanyaan", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Jalankan pertanyaan", exact: true }),
  ).toBeEnabled();
  await palette(page, "Makmal berpandu");
  await page
    .getByRole("button", { name: "Semak hasil semasa", exact: true })
    .click();
  await expect(page.getByText("Lulus — hasil anda tepat.")).toBeVisible();
});
test("unimplemented B-tree panel is honest and metrics are real", async ({
  page,
}) => {
  await showPlan(page);
  await page.getByRole("tab", { name: "Pokok-B", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Pokok-B belum dibina" }),
  ).toBeVisible();
  await page.getByRole("tab", { name: "Metrik", exact: true }).click();
  await expect(page.getByText("TELEMETRI SESI")).toBeVisible();
  await expect(page.locator(".metric-log")).toContainText("#1");
});
test("no console warnings, errors, or failed requests on startup", async ({
  page,
}) => {
  const issues: string[] = [];
  page.on("console", (msg) => {
    if (["error", "warning"].includes(msg.type())) issues.push(msg.text());
  });
  page.on("pageerror", (e) => issues.push(e.message));
  page.on("response", (r) => {
    if (r.status() >= 400) issues.push(`${r.status()} ${r.url()}`);
  });
  await page.reload();
  await expect(page.locator(".result-summary")).toHaveCount(1);
  await page.evaluate(() => document.fonts.ready);
  expect(issues).toEqual([]);
});
test("WCAG AA automated scan has no violations", async ({ page }) => {
  const result = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  expect(
    result.violations.map((v) => ({
      id: v.id,
      description: v.description,
      nodes: v.nodes.map((n) => ({
        target: n.target,
        summary: n.failureSummary,
      })),
    })),
  ).toEqual([]);
});

test("exports spreadsheet-safe CSV without changing displayed values", async ({
  page,
}) => {
  await run(page, "SELECT '=1+1' AS nama, -3 AS nilai;");
  await expect(page.getByRole("table")).toContainText("=1+1");
  const saved = page.waitForEvent("download");
  await page.getByRole("button", { name: "Eksport CSV", exact: true }).click();
  const file = await (await saved).path();
  expect(file).not.toBeNull();
  const data = await readFile(file!, "utf8");
  expect(data).toContain('"\'=1+1"');
  expect(data).toContain('"-3"');
});
test("untrusted result markup remains inert text", async ({ page }) => {
  await run(page, `SELECT '<img src=x onerror=alert(1)>' AS teks;`);
  await expect(page.getByRole("table")).toContainText(
    "<img src=x onerror=alert(1)>",
  );
  await expect(page.getByRole("table").locator("img")).toHaveCount(0);
});
test("keyboard arrows navigate result and inspector tabs", async ({ page }) => {
  await showResults(page);
  await page.getByRole("tab", { name: /^Hasil/ }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(
    page.getByRole("tab", { name: "Mesej", exact: true }),
  ).toBeFocused();
  await expect(
    page.getByRole("tab", { name: "Mesej", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await showPlan(page);
  await page.getByRole("tab", { name: "Pelan", exact: true }).focus();
  await page.keyboard.press("End");
  await expect(
    page.getByRole("tab", { name: "Metrik", exact: true }),
  ).toBeFocused();
});
test("four-table plans keep every scan node in the graph", async ({ page }) => {
  await run(
    page,
    "SELECT COUNT(*) FROM kursus a CROSS JOIN kursus b CROSS JOIN kursus c CROSS JOIN kursus d;",
  );
  await showPlan(page);
  const boxes = await page
    .locator(".plan-node > rect:nth-of-type(1)")
    .evaluateAll((nodes) =>
      nodes.map((node) => ({
        x: Number(node.getAttribute("x")),
        w: Number(node.getAttribute("width")),
      })),
    );
  const graphWidth = await page
    .locator(".plan-svg")
    .evaluate((svg) => (svg as SVGSVGElement).viewBox.baseVal.width);
  expect(boxes.length).toBeGreaterThan(4);
  expect(boxes.every((b) => b.x >= 0 && b.x + b.w <= graphWidth)).toBe(true);
});
test("shows concrete cell differences for a date-format limitation", async ({
  page,
}) => {
  await showResults(page);
  await page.getByRole("tab", { name: "Banding SQLite", exact: true }).click();
  await page.getByLabel("Aktifkan Banding SQLite").check();
  await run(page, "SELECT STRFTIME('%j', '2026-11-12') AS hari;");
  await expect(
    page.getByText("Perbezaan dikesan", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("table", { name: "" }).filter({ hasText: "VELA" }),
  ).toContainText("316");
});
test("production headers are applied when testing the built app", async ({
  page,
}) => {
  const response = await page.request.get("/");
  expect(response.ok()).toBe(true);
  if (process.env.VELA_E2E_PRODUCTION === "1") {
    expect(response.headers()["content-security-policy"]).toContain(
      "object-src 'none'",
    );
    expect(response.headers()["x-content-type-options"]).toBe("nosniff");
  }
});
