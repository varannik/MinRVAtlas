import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";

const OUT = "shots";
const URL = process.env.URL ?? "http://localhost:3000";

await mkdir(OUT, { recursive: true });

const browser = await chromium.launch({
  args: [
    "--use-gl=angle",
    "--use-angle=swiftshader",
    "--enable-unsafe-swiftshader",
  ],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 950 } });
page.on("pageerror", (error) => console.log(`[pageerror] ${error.message}`));

await page.goto(URL, { waitUntil: "networkidle" });
await page.waitForTimeout(6000);
await page.locator("aside button", { hasText: "Kasigau" }).first().click();
await page.waitForTimeout(5000);

for (const [name, x, y] of [
  ["left", 180, 700],
  ["right", 700, 200],
]) {
  await page.mouse.move(x, y, { steps: 20 });
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${OUT}/tilt-${name}.png` });
}

await browser.close();
console.log("captured tilt");
