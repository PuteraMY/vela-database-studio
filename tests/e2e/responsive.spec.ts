import { test, expect } from "@playwright/test";
for (const width of [360, 768, 1100, 1440])
  test(`layout at ${width}px has no page overflow and reachable panels`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/");
    await expect(page.locator(".result-summary")).toHaveCount(1);
    const overflow = () =>
      page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
    expect(await overflow()).toBe(false);
    if (width < 768) {
      for (const name of ["Hasil", "Pelan", "Pokok", "Skema", "Editor"]) {
        await page
          .getByRole("navigation", { name: "Panel studio" })
          .getByRole("button", { name, exact: true })
          .click();
        expect(await overflow()).toBe(false);
      }
      const smallTargets = await page
        .locator("button:visible")
        .evaluateAll((elements) =>
          elements
            .filter((e) => {
              const r = e.getBoundingClientRect();
              return r.width < 43.9 || r.height < 43.9;
            })
            .map((e) => ({
              name: e.getAttribute("aria-label") ?? e.textContent,
              size: e.getBoundingClientRect().toJSON(),
            })),
        );
      expect(smallTargets).toEqual([]);
    } else if (width < 1100) {
      await page.getByRole("button", { name: "Buka skema" }).click();
      await expect(
        page.getByRole("complementary", { name: "Penjelajah skema" }),
      ).toBeVisible();
      await page.getByRole("button", { name: "Tutup skema" }).click();
      await expect(
        page.getByRole("complementary", { name: "Penjelajah skema" }),
      ).toBeHidden();
      await expect(
        page.getByRole("complementary", { name: "Pemeriksa", exact: true }),
      ).toBeVisible();
    } else {
      await expect(
        page.getByRole("complementary", { name: "Penjelajah skema" }),
      ).toBeVisible();
      await expect(
        page.getByRole("complementary", { name: "Pemeriksa", exact: true }),
      ).toBeVisible();
    }
  });
test("mobile swipe switches panels without page overflow", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.locator(".result-summary")).toHaveCount(1);
  const header = page.locator(".editor-caption");
  await header.evaluate((element) => {
    const start = new Touch({
      identifier: 1,
      target: element,
      clientX: 320,
      clientY: 190,
    });
    const end = new Touch({
      identifier: 1,
      target: element,
      clientX: 80,
      clientY: 195,
    });
    element.dispatchEvent(
      new TouchEvent("touchstart", { bubbles: true, touches: [start] }),
    );
    element.dispatchEvent(
      new TouchEvent("touchend", { bubbles: true, changedTouches: [end] }),
    );
  });
  await expect(
    page.getByRole("button", { name: "Hasil", exact: true }),
  ).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("table")).toBeVisible();
});
test("reduced motion disables plan animation", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.goto("/");
  await expect(page.locator(".result-summary")).toHaveCount(1);
  await page.getByRole("button", { name: "Main semula pelan" }).click();
  await expect
    .poll(() =>
      page
        .locator(".flow-line")
        .first()
        .evaluate((el) => getComputedStyle(el).animationName),
    )
    .toBe("none");
});
