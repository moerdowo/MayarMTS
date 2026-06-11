// Record docs/demo.gif from a running dev server (npm run dev), using demo
// mode — captures the live-ticker entry animation and number count-ups.
// Usage: node scripts/record-gif.mjs [url]
// Requires ffmpeg on PATH.
import puppeteer from "puppeteer-core";
import { execSync } from "child_process";
import { mkdirSync, rmSync } from "fs";

const url = process.argv[2] || "http://localhost:3000";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const FRAMES_DIR = "/tmp/mayarmts-frames";
const DURATION_MS = 11000; // ~3 demo ticks (every 3.2s)

rmSync(FRAMES_DIR, { recursive: true, force: true });
mkdirSync(FRAMES_DIR, { recursive: true });
mkdirSync("docs", { recursive: true });

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "shell",
});
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 720, deviceScaleFactor: 1 });
await page.goto(url, { waitUntil: "networkidle0" });
await page.evaluate(() => localStorage.setItem("mayar_monitor_demo", "1"));
await page.reload({ waitUntil: "networkidle0" });
// let the initial count-up mostly settle so the GIF focuses on live updates
await new Promise((r) => setTimeout(r, 7000));

let i = 0;
const t0 = Date.now();
while (Date.now() - t0 < DURATION_MS) {
  await page.screenshot({
    path: `${FRAMES_DIR}/f${String(i++).padStart(4, "0")}.png`,
  });
}
const elapsed = (Date.now() - t0) / 1000;
await browser.close();

const fps = (i / elapsed).toFixed(2);
console.log(`captured ${i} frames in ${elapsed.toFixed(1)}s (~${fps} fps)`);

execSync(
  `ffmpeg -y -framerate ${fps} -i ${FRAMES_DIR}/f%04d.png ` +
    `-vf "fps=10,scale=1000:-1:flags=lanczos,split[s0][s1];[s0]palettegen=max_colors=128[p];[s1][p]paletteuse=dither=bayer:bayer_scale=4" ` +
    `docs/demo.gif`,
  { stdio: "inherit" }
);
rmSync(FRAMES_DIR, { recursive: true, force: true });
console.log("wrote docs/demo.gif");
