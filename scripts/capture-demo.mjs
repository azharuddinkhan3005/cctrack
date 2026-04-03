/**
 * capture-demo.mjs — Capture animated demo frames from the cctrack dashboard
 *
 * Serves the mock dashboard via localhost so ECharts CDN loads properly,
 * then uses Playwright to screenshot each step of a guided tour.
 *
 * Usage:
 *   cd /Users/corekhan/Sites/cctrack
 *   node scripts/capture-demo.mjs
 *
 * Requires: playwright (pnpm install), ffmpeg or ImageMagick
 * Output:   assets/demo.gif (~2-5 MB, 800px wide, ~30s loop)
 */
import { chromium } from 'playwright';
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, unlinkSync, statSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

const DASHBOARD = '/tmp/cctrack-mock.html';
const FRAMES_DIR = '/tmp/cctrack-demo-frames';
const OUTPUT_GIF = join(ROOT, 'assets', 'demo.gif');
const VIEWPORT = { width: 1200, height: 800 };
const PORT = 9877;

// ---------- Utilities ----------

function cleanDir(dir) {
  if (existsSync(dir)) {
    for (const f of readdirSync(dir)) unlinkSync(join(dir, f));
  } else {
    mkdirSync(dir, { recursive: true });
  }
}

function cmdExists(cmd) {
  try { execSync(`which ${cmd}`, { stdio: 'pipe' }); return true; }
  catch { return false; }
}

let frameNum = 0;
function nextFrame() {
  return join(FRAMES_DIR, `frame-${String(frameNum++).padStart(3, '0')}.png`);
}

/** Take N identical screenshots (each = ~1.3s hold in final GIF) */
async function hold(page, n = 1) {
  for (let i = 0; i < n; i++) {
    await page.screenshot({ path: nextFrame(), fullPage: false });
  }
}

// ---------- HTTP server ----------

function startServer() {
  const html = readFileSync(DASHBOARD, 'utf-8');
  const server = createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
  });
  return new Promise((resolve) => {
    server.listen(PORT, '127.0.0.1', () => {
      console.log(`  Serving dashboard at http://127.0.0.1:${PORT}/`);
      resolve(server);
    });
  });
}

// ---------- Frame capture ----------

async function captureFrames() {
  cleanDir(FRAMES_DIR);
  mkdirSync(join(ROOT, 'assets'), { recursive: true });

  const server = await startServer();

  console.log('  Launching Chromium...');
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor: 2,
  });
  const page = await context.newPage();
  page.on('pageerror', (err) => console.log('  [page error]', err.message));

  console.log('  Loading dashboard + waiting for ECharts...');
  await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'networkidle' });

  try {
    await page.waitForFunction(() => typeof echarts !== 'undefined', { timeout: 15000 });
  } catch {
    console.log('  WARNING: ECharts CDN did not load. Charts may be empty.');
  }
  await page.waitForTimeout(3500);

  const canvasCount = await page.evaluate(() => document.querySelectorAll('canvas').length);
  console.log(`  ${canvasCount} chart canvases rendered\n`);

  // ===== FRAME SEQUENCE =====
  // Target: ~30s GIF. Frame rate = 10/13 fps => ~1.3s per frame.
  // 21 frames total => ~27s.

  // --- Act 1: Dashboard tour (dark mode) ---

  // Hero: stat cards + cost chart
  console.log('  [1/11] Hero overview (dark mode)');
  await hold(page, 3);  // ~3.9s

  // I/O + Cache token charts
  console.log('  [2/11] I/O + Cache tokens');
  await page.evaluate(() => window.scrollTo({ top: 520, behavior: 'instant' }));
  await page.waitForTimeout(400);
  await hold(page, 2);  // ~2.6s

  // Project + Model breakdown
  console.log('  [3/11] Project + Model breakdown');
  await page.evaluate(() => window.scrollTo({ top: 1080, behavior: 'instant' }));
  await page.waitForTimeout(400);
  await hold(page, 2);  // ~2.6s

  // Heatmap
  console.log('  [4/11] Usage heatmap');
  await page.evaluate(() => window.scrollTo({ top: 1700, behavior: 'instant' }));
  await page.waitForTimeout(400);
  await hold(page, 2);  // ~2.6s

  // Sessions table
  console.log('  [5/11] Sessions table');
  await page.evaluate(() => window.scrollTo({ top: 2350, behavior: 'instant' }));
  await page.waitForTimeout(400);
  await hold(page, 1);  // ~1.3s

  // ROI
  console.log('  [6/11] ROI Analysis');
  await page.evaluate(() => window.scrollTo({ top: 2900, behavior: 'instant' }));
  await page.waitForTimeout(400);
  await hold(page, 1);  // ~1.3s

  // --- Act 2: Interactive features ---

  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
  await page.waitForTimeout(300);

  // Light mode
  console.log('  [7/11] Light mode');
  await page.click('#themeToggle');
  await page.waitForTimeout(1500);
  await hold(page, 2);  // ~2.6s

  // Scroll in light mode
  console.log('  [8/11] Light mode charts');
  await page.evaluate(() => window.scrollTo({ top: 520, behavior: 'instant' }));
  await page.waitForTimeout(400);
  await hold(page, 1);  // ~1.3s

  // Back to dark
  console.log('  [9/11] Back to dark mode');
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
  await page.waitForTimeout(300);
  await page.click('#themeToggle');
  await page.waitForTimeout(1500);
  await hold(page, 1);  // ~1.3s

  // Filter: web-app
  console.log('  [10/11] Filter: web-app');
  await page.selectOption('#projectFilter', 'web-app');
  await page.click('#btnApply');
  await page.waitForTimeout(2000);
  await hold(page, 2);  // ~2.6s

  // Scroll filtered view
  await page.evaluate(() => window.scrollTo({ top: 520, behavior: 'instant' }));
  await page.waitForTimeout(400);
  await hold(page, 1);  // ~1.3s

  // Reset + final hero
  console.log('  [11/11] Reset + final hero');
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
  await page.waitForTimeout(300);
  await page.click('#btnReset');
  await page.waitForTimeout(1500);
  await hold(page, 3);  // ~3.9s (loop point)

  await browser.close();
  server.close();
  console.log(`\n  Captured ${frameNum} frames`);
}

// ---------- GIF assembly ----------

function ffmpegAssemble(width, colors) {
  console.log(`  ffmpeg: ${width}px, ${colors} colors...`);

  // Use 1fps input rate; the GIF encoder with "fps=1" keeps 1 frame/sec,
  // but we want ~1.3s per frame. Since GIF delay is in centiseconds,
  // we'll use fps=1 and then fix delays with gifsicle if available,
  // or accept 1s/frame (~24s total) as a reasonable alternative.
  // Actually: use framerate 1/1.3 = 10/13 as a rational fraction.
  const fr = '10/13';

  execSync(
    `ffmpeg -y -framerate ${fr} -i "${FRAMES_DIR}/frame-%03d.png" ` +
    `-vf "scale=${width}:-1:flags=lanczos,palettegen=max_colors=${colors}:stats_mode=diff" ` +
    `/tmp/cctrack-palette.png`,
    { stdio: 'pipe' }
  );
  execSync(
    `ffmpeg -y -framerate ${fr} -i "${FRAMES_DIR}/frame-%03d.png" ` +
    `-i /tmp/cctrack-palette.png ` +
    `-lavfi "scale=${width}:-1:flags=lanczos [x]; [x][1:v] paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle" ` +
    `-loop 0 "${OUTPUT_GIF}"`,
    { stdio: 'pipe' }
  );
}

function assembleGif() {
  console.log('\n=== Assembling GIF ===');

  const hasFfmpeg = cmdExists('ffmpeg');
  const hasMagick = cmdExists('magick');
  const hasConvert = cmdExists('convert');
  const hasGifsicle = cmdExists('gifsicle');

  console.log(`  ffmpeg=${hasFfmpeg} magick=${hasMagick} convert=${hasConvert} gifsicle=${hasGifsicle}`);

  if (hasFfmpeg) {
    ffmpegAssemble(800, 128);
  } else if (hasMagick || hasConvert) {
    const bin = hasMagick ? 'magick' : 'convert';
    console.log(`  Using ${bin}...`);
    execSync(
      `${bin} -delay 130 -loop 0 -resize 800x -layers OptimizePlus -colors 128 ` +
      `"${FRAMES_DIR}"/frame-*.png "${OUTPUT_GIF}"`,
      { stdio: 'inherit' }
    );
  } else {
    console.error('  ERROR: No GIF assembly tool found.');
    console.log(`  Frames saved in ${FRAMES_DIR}`);
    console.log('  Install: brew install ffmpeg');
    process.exit(1);
  }

  // Optimize
  if (hasGifsicle && existsSync(OUTPUT_GIF)) {
    console.log('  Optimizing with gifsicle...');
    try {
      execSync(`gifsicle --optimize=3 --colors 128 -b "${OUTPUT_GIF}"`, { stdio: 'pipe' });
    } catch { /* skip */ }
  }

  // Size check + progressive reduction
  if (existsSync(OUTPUT_GIF)) {
    let size = statSync(OUTPUT_GIF).size;
    console.log(`  Initial: ${(size / 1024 / 1024).toFixed(2)} MB`);

    if (size > 5 * 1024 * 1024 && hasFfmpeg) {
      console.log('  > 5 MB, reducing to 640px / 64 colors...');
      ffmpegAssemble(640, 64);
      if (hasGifsicle) {
        try { execSync(`gifsicle --optimize=3 --colors 64 -b "${OUTPUT_GIF}"`, { stdio: 'pipe' }); } catch {}
      }
      size = statSync(OUTPUT_GIF).size;
      console.log(`  Reduced: ${(size / 1024 / 1024).toFixed(2)} MB`);
    }

    if (size > 10 * 1024 * 1024 && hasFfmpeg) {
      console.log('  Still > 10 MB, aggressive: 480px / 48 colors...');
      ffmpegAssemble(480, 48);
      if (hasGifsicle) {
        try { execSync(`gifsicle --optimize=3 --colors 48 -b "${OUTPUT_GIF}"`, { stdio: 'pipe' }); } catch {}
      }
      size = statSync(OUTPUT_GIF).size;
      console.log(`  Final: ${(size / 1024 / 1024).toFixed(2)} MB`);
    }

    console.log(`\n  Output: ${OUTPUT_GIF}`);
    console.log(`  Size: ${(statSync(OUTPUT_GIF).size / 1024 / 1024).toFixed(2)} MB`);
  } else {
    console.error('  ERROR: GIF was not created!');
    process.exit(1);
  }
}

// ---------- Main ----------

async function main() {
  console.log('=== CCTrack Demo GIF Generator ===\n');
  console.log('=== Capturing frames ===');
  await captureFrames();
  assembleGif();
  console.log('\nDone!');
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
