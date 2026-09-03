import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";

const OUT = "shots";
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

await page.goto("http://localhost:3000", { waitUntil: "networkidle" });
await page.waitForTimeout(4000);

await page.locator("aside button", { hasText: "Fujairah" }).first().click();
await page.waitForTimeout(5000);

// Rest pose: pointer parked off the board, on the back button.
const back = page.getByRole("button", { name: /Back to world map/ });
const box = await back.boundingBox();
if (box) {
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
}
await page.waitForTimeout(1800);
await page.screenshot({ path: `${OUT}/9-board-front.png` });
await page.screenshot({
  path: `${OUT}/9b-board-front-crop.png`,
  clip: { x: 80, y: 200, width: 900, height: 680 },
});

// Pointer on the board: lower-right of the slab region.
await page.mouse.move(720, 640);
await page.waitForTimeout(1200);
await page.screenshot({
  path: `${OUT}/9c-board-hover.png`,
  clip: { x: 80, y: 200, width: 900, height: 680 },
});

await browser.close();
console.log("captured");
