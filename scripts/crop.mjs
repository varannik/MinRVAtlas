import { chromium } from "playwright";

const browser = await chromium.launch({
  args: [
    "--use-gl=angle",
    "--use-angle=swiftshader",
    "--enable-unsafe-swiftshader",
  ],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 950 } });
await page.goto("http://localhost:3000", { waitUntil: "networkidle" });
await page.waitForTimeout(7000);
await page.screenshot({
  path: "shots/right-edge.png",
  clip: { x: 1150, y: 40, width: 450, height: 620 },
});
await browser.close();
console.log("cropped");
