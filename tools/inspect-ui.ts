import { chromium } from "@playwright/test";
import { writeFile } from "node:fs/promises";
const browser = await chromium.launch({
  headless: true,
  args: ["--no-sandbox"],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
const issues: string[] = [];
page.on("pageerror", (e) => issues.push(e.message));
page.on("console", (m) => {
  if (["error", "warning"].includes(m.type())) issues.push(m.text());
});
await page.goto(process.env.VELA_PROFILE_URL ?? "http://127.0.0.1:4173");
await page.getByText("Pertanyaan berjaya", { exact: true }).waitFor();
await page.evaluate(() => document.fonts.ready);
await (
  await import("node:fs/promises")
).mkdir("artifacts/screenshots", { recursive: true });
const layouts = [];
for (const width of [1440, 1100, 768, 390, 360]) {
  await page.setViewportSize({ width, height: 960 });
  await page.screenshot({
    path: `artifacts/screenshots/vela-${width}.png`,
    fullPage: true,
  });
  layouts.push(
    await page.evaluate(() => ({
      width: innerWidth,
      scrollWidth: document.documentElement.scrollWidth,
      bodyWidth: document.body.scrollWidth,
      editor: document
        .querySelector(".editor-panel")
        ?.getBoundingClientRect()
        .toJSON(),
      results: document
        .querySelector(".results-panel")
        ?.getBoundingClientRect()
        .toJSON(),
    })),
  );
}
await writeFile(
  "artifacts/ui-inspection.json",
  JSON.stringify({ issues, layouts }, null, 2),
);
console.log(JSON.stringify({ issues, layouts }, null, 2));
await browser.close();
