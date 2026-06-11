// Regenerate docs/screenshot.png from a running dev server (npm run dev),
// using demo mode. Usage: node scripts/screenshot.mjs [url]
import puppeteer from "puppeteer-core";
import { mkdirSync } from "fs";

const url = process.argv[2] || "http://localhost:3000";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

mkdirSync("docs", { recursive: true });

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "shell",
});
const page = await browser.newPage();
await page.setViewport({ width: 1600, height: 900, deviceScaleFactor: 2 });
await page.goto(url, { waitUntil: "networkidle0" });
await page.evaluate(() => localStorage.setItem("mayar_monitor_demo", "1"));
await page.reload({ waitUntil: "networkidle0" });
// let the count-up tween settle on the demo numbers
await new Promise((r) => setTimeout(r, 9000));
await page.screenshot({ path: "docs/screenshot.png" });
await browser.close();
console.log("wrote docs/screenshot.png");
