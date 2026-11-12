import { chromium } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
interface Metrics {
  lcpMs: number;
  cls: number;
  shiftWindowStart: number;
  shiftWindowLast: number;
  shiftWindowValue: number;
  events: number[];
  longTasks: number[];
  frames: number[];
  sampling: boolean;
  lastFrame: number;
}
declare global {
  interface Window {
    velaProfile: Metrics;
  }
}
const baseURL = process.env.VELA_PROFILE_URL ?? "http://127.0.0.1:4173";
const browser = await chromium.launch();
const samples = [];
for (const width of [1440, 390]) {
  const page = await browser.newPage({
    viewport: { width, height: width < 768 ? 844 : 960 },
    hasTouch: width < 768,
  });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (["error", "warning"].includes(m.type())) errors.push(m.text());
  });
  // Raw source avoids transpiler helpers leaking into the browser realm.
  await page.addInitScript({
    content: String.raw`
    window.velaProfile = {
      lcpMs: 0,
      cls: 0,
      shiftWindowStart: 0,
      shiftWindowLast: 0,
      shiftWindowValue: 0,
      events: [],
      longTasks: [],
      frames: [],
      sampling: false,
      lastFrame: 0,
    };
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) window.velaProfile.lcpMs = e.startTime;
    }).observe({ type: "largest-contentful-paint", buffered: true });
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) {
        if (e.hadRecentInput) continue;
        const m = window.velaProfile;
        if (e.startTime - m.shiftWindowLast > 1000 || e.startTime - m.shiftWindowStart > 5000) {
          m.shiftWindowStart = e.startTime;
          m.shiftWindowValue = 0;
        }
        m.shiftWindowLast = e.startTime;
        m.shiftWindowValue += e.value;
        m.cls = Math.max(m.cls, m.shiftWindowValue);
      }
    }).observe({ type: "layout-shift", buffered: true });
    new PerformanceObserver((list) => {
      for (const e of list.getEntries())
        window.velaProfile.longTasks.push(e.duration);
    }).observe({ type: "longtask", buffered: true });
    new PerformanceObserver((list) => {
      for (const e of list.getEntries())
        if (e.interactionId)
          window.velaProfile.events.push(e.duration);
    }).observe({
      type: "event",
      buffered: true,
      durationThreshold: 16,
    });
    const frame = (time) => {
      const m = window.velaProfile;
      if (m.sampling && m.lastFrame) m.frames.push(time - m.lastFrame);
      m.lastFrame = m.sampling ? time : 0;
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  `,
  });
  const started = performance.now();
  await page.goto(baseURL);
  await page.locator(".result-summary").waitFor({ state: "attached" });
  await page.evaluate(() => document.fonts.ready);
  const readyMs = performance.now() - started;
  // Let pending paint/layout observer entries settle before the first interaction.
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  const initialCls = await page.evaluate(() => window.velaProfile.cls);
  await page.keyboard.press("Control+k");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Jana data ujian", exact: false })
    .click();
  await page.getByRole("radio", { name: "100,000 baris", exact: true }).check();
  await page
    .getByRole("button", { name: "Jana 100,000 baris", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Jalankan pertanyaan", exact: true })
    .waitFor();
  await page.waitForFunction(
    () =>
      !document.querySelector<HTMLButtonElement>(
        '[aria-label="Jalankan pertanyaan"]',
      )?.disabled,
  );
  if (width < 768)
    await page.getByRole("button", { name: "Editor", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Editor SQL", exact: true })
    .fill("SELECT id, nama, nilai FROM data_janaan;");
  await page.evaluate(() => {
    window.velaProfile.sampling = true;
    window.velaProfile.frames = [];
    window.velaProfile.lastFrame = 0;
  });
  const queryStart = performance.now();
  await page
    .getByRole("button", { name: "Jalankan pertanyaan", exact: true })
    .click();
  await page.waitForFunction(
    () =>
      !document.querySelector<HTMLButtonElement>(
        '[aria-label="Jalankan pertanyaan"]',
      )?.disabled,
  );
  await page.getByRole("table").waitFor();
  const queryRoundtripMs = performance.now() - queryStart;
  await page.locator(".table-scroll").evaluate(async (el) => {
    for (let i = 0; i < 60; i++) {
      el.scrollTop = (i * (el.scrollHeight - el.clientHeight)) / 59;
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => resolve()),
      );
    }
  });
  const metrics = await page.evaluate(() => {
    const m = window.velaProfile;
    m.sampling = false;
    return {
      ...m,
      resources: performance.getEntriesByType("resource").map((e) => ({
        name: e.name.split("/").at(-1),
        bytes: (e as PerformanceResourceTiming).encodedBodySize,
      })),
      domRows: document.querySelectorAll("tbody tr").length,
    };
  });
  const frames = [...metrics.frames].sort((a, b) => a - b);
  samples.push({
    width,
    readyMs,
    queryRoundtripMs,
    lcpMs: metrics.lcpMs,
    initialCls,
    scriptedWorkloadCls: metrics.cls,
    maxObservedInteractionMs: Math.max(0, ...metrics.events),
    longTasks: metrics.longTasks,
    frameSamples: frames.length,
    medianFrameMs: frames[Math.floor(frames.length / 2)],
    p95FrameMs: frames[Math.floor(frames.length * 0.95)],
    maxFrameMs: Math.max(...frames),
    domRows: metrics.domRows,
    resourceBytes: metrics.resources.reduce((sum, r) => sum + r.bytes, 0),
    errors,
  });
  await page.close();
}
await mkdir("artifacts", { recursive: true });
const report = {
  date: new Date().toISOString(),
  browser: browser.version(),
  url: baseURL,
  scope:
    "One desktop and one mobile lab run; no CPU/network throttling. Event Timing maximum is a lab interaction proxy, not field INP. Frame sample combines 100k-result Worker roundtrip/render and 60 scripted scroll frames. CLS uses maximum session windows; initial CLS is captured before input, workload CLS includes artificial large scroll jumps and is not a field CWV score. LCP may be finalized by first interaction.",
  samples,
};
await writeFile(
  "artifacts/browser-profile.json",
  JSON.stringify(report, null, 2),
);
console.log(JSON.stringify(report, null, 2));
await browser.close();
if (samples.some((sample) => sample.errors.length || sample.frameSamples === 0))
  process.exitCode = 1;
