/**
 * Regenerates the fallback PWA icons in public/ from public/brand-logo.svg
 * (white background, logo centred). Used only when no custom logo has been
 * uploaded. Run: npx tsx scripts/generate-icons.ts
 */
import { readFileSync } from "node:fs";
import { chromium } from "playwright-core";

const svg = readFileSync(new URL("../public/brand-logo.svg", import.meta.url), "utf8");
const executablePath = process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const browser = await chromium.launch({ executablePath });
const page = await browser.newPage();
for (const [name, size, scale] of [["app-icon-192.png", 192, 0.72], ["app-icon-512.png", 512, 0.72], ["apple-touch-icon.png", 180, 0.78]] as const) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<html><body style="margin:0;background:#fff;display:grid;place-items:center;width:${size}px;height:${size}px">
    <div style="width:${size * scale}px;height:${size * scale}px">${svg.replace("<svg ", '<svg style="width:100%;height:100%" ')}</div></body></html>`);
  await page.screenshot({ path: new URL(`../public/${name}`, import.meta.url).pathname });
}
await browser.close();
console.log("Icone generate in public/");
