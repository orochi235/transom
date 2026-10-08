// Checks the lightbox loupe in a real browser: a picture of one-pixel red and
// blue squares blurs to purple at fit, so a lens showing pure red and pure blue
// is reading the picture's own pixels. Runs its own daemon and page server on
// spare ports against a scratch root, and deletes the root on the way out.
//
//   node tools/loupe-check.mjs        (LOUPE_PLAYWRIGHT=<path> if not global,
//                                      LOUPE_SHOT=<png> to keep the smooth lens)
import { spawn } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'

const DAEMON = Number(process.env.LOUPE_DAEMON_PORT ?? 18787)
const CLIENT = Number(process.env.LOUPE_CLIENT_PORT ?? 17750)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function playwright() {
  for (const id of [process.env.LOUPE_PLAYWRIGHT, 'playwright', 'playwright-core'].filter(Boolean)) {
    try {
      return await import(id)
    } catch {}
  }
  throw new Error('no playwright: `npm i -g playwright-core`, or set LOUPE_PLAYWRIGHT to a copy')
}

async function checker(path) {
  const w = 1600
  const h = 1000
  const px = Buffer.alloc(w * h * 3)
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 3
      if ((x + y) % 2) px[i] = 255
      else px[i + 2] = 255
    }
  await sharp(px, { raw: { width: w, height: h, channels: 3 } }).png().toFile(path)
}

/** A drawing with only a viewBox, 3:1, split red and blue along a diagonal.
 *  At its declared 60×20 a pixel lens would enlarge its edge into a ramp. */
const DRAWING = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 60 20">
  <rect width="60" height="20" fill="#0000ff"/>
  <polygon points="0,0 60,20 0,20" fill="#ff0000"/>
</svg>`

/** The card the daemon reports in `zone`, once it has ingested it. */
async function itemIn(zone) {
  for (let tries = 0; tries < 60; tries++) {
    const item = await new Promise((resolve) => {
      const ws = new WebSocket(`ws://localhost:${DAEMON}/ws`)
      ws.onmessage = (e) => {
        ws.close()
        resolve(JSON.parse(e.data).items?.find((i) => i.zone === zone) ?? null)
      }
      ws.onerror = () => resolve(null)
    })
    if (item) return item
    await sleep(500)
  }
  throw new Error('the daemon never reported the picture')
}

/** How many rows of a PNG put their red-to-blue edge at a column no row above
 *  did. A redrawn diagonal moves on nearly every row; a bitmap enlarged from
 *  60×20 holds one column for a whole block of rows, then jumps. */
async function edgeSteps(png) {
  const { data, info } = await sharp(png).raw().toBuffer({ resolveWithObject: true })
  const seen = new Set()
  for (let y = 0; y < info.height; y++) {
    for (let x = 0; x < info.width; x++) {
      const i = (y * info.width + x) * info.channels
      if (data[i + 2] > data[i]) {
        seen.add(x)
        break
      }
    }
  }
  return seen.size
}

/** Pure red and pure blue pixels in a PNG, against everything else. */
async function colors(png) {
  const { data, info } = await sharp(png).raw().toBuffer({ resolveWithObject: true })
  let pure = 0
  let other = 0
  for (let i = 0; i < data.length; i += info.channels) {
    const [r, g, b] = [data[i], data[i + 1], data[i + 2]]
    if (g < 25 && ((r > 230 && b < 25) || (b > 230 && r < 25))) pure++
    else other++
  }
  return pure / (pure + other)
}

const root = mkdtempSync(join(tmpdir(), 'transom-loupe-'))
const env = { ...process.env, TRANSOM_ROOT: root, TRANSOM_PORT: String(DAEMON), TRANSOM_CLIENT_PORT: String(CLIENT) }
const children = [
  spawn('npx', ['tsx', 'server/index.ts'], { env, stdio: 'ignore', detached: true }),
  spawn('npx', ['vite', '--port', String(CLIENT), '--strictPort'], { env, stdio: 'ignore', detached: true }),
]
let failed = 0
const check = (name, ok, detail) => {
  if (!ok) failed++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? `  (${detail})` : ''}`)
}

try {
  mkdirSync(join(root, 'inbox', 'loupe'), { recursive: true })
  mkdirSync(join(root, 'inbox', 'vector'), { recursive: true })
  await checker(join(root, 'inbox', 'loupe', 'checker.png'))
  writeFileSync(join(root, 'inbox', 'vector', 'diagonal.svg'), DRAWING)
  const item = await itemIn('loupe')
  const { chromium } = await playwright()
  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
  await page.goto(`http://localhost:${CLIENT}/#/loupe/${item.id}`, { waitUntil: 'networkidle' })
  await page.waitForSelector('.lightbox__img--in')
  await sleep(500)

  check('the cue says how to raise it', (await page.locator('.lightbox__loupeCue').textContent()) === 'hold alt for loupe')
  const lens = { x: 600, y: 410, width: 90, height: 90 }
  await page.mouse.move(640, 450)
  await sleep(200)
  const fit = await colors(await page.screenshot({ clip: lens }))
  check('at fit the picture blurs', fit < 0.05, `${(fit * 100).toFixed(1)}% pure`)

  await page.keyboard.down('Alt')
  await page.mouse.move(645, 452)
  await sleep(500)
  const held = await colors(await page.screenshot({ clip: lens }))
  check('Alt shows the picture’s own pixels', held > 0.95, `${(held * 100).toFixed(1)}% pure`)
  const hex = await page.locator('.lightbox__hex').textContent()
  check('the meta line reads the color under the pointer', hex === '#ff0000' || hex === '#0000ff', hex)

  await page.keyboard.press('KeyS')
  await page.mouse.move(646, 452)
  await sleep(300)
  const smooth = await colors(await page.screenshot({ clip: lens }))
  if (process.env.LOUPE_SHOT) await page.screenshot({ path: process.env.LOUPE_SHOT, clip: { x: 340, y: 150, width: 600, height: 600 } })
  check('Alt+S smooths the lens', smooth < 0.5, `${(smooth * 100).toFixed(1)}% pure`)
  check('the cue says which', (await page.locator('.lightbox__loupeCue').textContent()).startsWith('smooth'))
  await page.keyboard.press('KeyS')
  await page.mouse.move(645, 452)
  await sleep(300)
  const back = await colors(await page.screenshot({ clip: lens }))
  check('Alt+S again goes back to pixels', back > 0.95, `${(back * 100).toFixed(1)}% pure`)

  for (let i = 0; i < 3; i++) await page.mouse.wheel(0, -200)
  await sleep(400)
  check('the wheel is the lens’s while it is up', (await page.locator('.lightbox__zoom').count()) === 0)

  await page.keyboard.up('Alt')
  await page.mouse.move(650, 455)
  await sleep(400)
  check('letting go of Alt puts it away', (await page.locator('.lk-loupe, .lightbox__hex').count()) === 0)

  const drawing = await itemIn('vector')
  check('an SVG lands with its viewBox’s shape', drawing.w === 60 && drawing.h === 20, `${drawing.w}×${drawing.h}`)
  await page.goto(`http://localhost:${CLIENT}/#/vector/${drawing.id}`, { waitUntil: 'networkidle' })
  await page.waitForSelector('.lightbox__img--in')
  await sleep(500)
  const shown = await page.locator('.lightbox__img').boundingBox()
  check('the lightbox shows it 3:1, not 300×150', Math.abs(shown.width / shown.height - 3) < 0.05, `${(shown.width / shown.height).toFixed(2)}`)
  const mid = { x: shown.x + shown.width / 2, y: shown.y + shown.height / 2 }
  await page.mouse.move(mid.x, mid.y)
  await page.keyboard.down('Alt')
  await page.mouse.move(mid.x + 1, mid.y)
  await sleep(500)
  check('the cue says vector', (await page.locator('.lightbox__loupeCue').textContent()) === 'vector')
  const edge = await edgeSteps(await page.screenshot({ clip: { x: mid.x - 45, y: mid.y - 45, width: 90, height: 90 } }))
  if (process.env.LOUPE_SHOT) await page.screenshot({ path: process.env.LOUPE_SHOT.replace(/\.png$/, '-vector.png'), clip: { x: mid.x - 220, y: mid.y - 220, width: 440, height: 440 } })
  check('the lens redraws the edge rather than enlarging it', edge > 20, `${edge} edge columns in 90 rows`)
  await page.keyboard.up('Alt')
  await browser.close()
} finally {
  // Each in its own group: npx forks the real server, which a plain kill misses.
  for (const child of children) process.kill(-child.pid)
  rmSync(root, { recursive: true, force: true })
}
process.exit(failed ? 1 : 0)
