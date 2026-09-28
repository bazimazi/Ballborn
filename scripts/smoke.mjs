// Browser smoke test. Builds are served with `vite preview`; a locally installed
// Chrome or Edge is driven with playwright-core in a fresh, isolated profile, so
// real saves in your everyday browser are never touched.
//
//   npm run build && node scripts/smoke.mjs [--soak-minutes 15] [--shots docs/screenshots]
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { chromium } from 'playwright-core'

const args = process.argv.slice(2)
const arg = (name, fallback) => {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : fallback
}
const SOAK_MIN = Number(arg('--soak-minutes', '15'))
const SHOTS = arg('--shots', 'docs/screenshots')
const PORT = 4179
const URL = `http://127.0.0.1:${PORT}/?debug`
const browsers = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].filter(Boolean)
const executablePath = browsers.find((p) => existsSync(p))
if (!executablePath) {
  console.error('No Chrome or Edge found. Set CHROME_PATH.')
  process.exit(2)
}
mkdirSync(SHOTS, { recursive: true })

const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--host', '127.0.0.1', '--port', String(PORT), '--strictPort'], { stdio: 'pipe' })
await new Promise((resolve, reject) => {
  const t = setTimeout(() => reject(new Error('preview server did not start')), 20000)
  server.stdout.on('data', (d) => {
    if (String(d).includes(String(PORT))) {
      clearTimeout(t)
      resolve()
    }
  })
})

const report = { browser: executablePath, checks: [], errors: [], perf: {}, layout: [], soak: {} }
const check = (name, ok, detail = '') => {
  report.checks.push({ name, ok: !!ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`)
}

const browser = await chromium.launch({ executablePath, headless: true, args: ['--autoplay-policy=no-user-gesture-required'] })
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } })
  // A scriptable fake gamepad so controller-only menu flow can be exercised.
  await context.addInitScript(() => {
    const pad = { connected: true, index: 0, id: 'smoke pad', axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })) }
    window.__pad = pad
    window.__padOn = false
    navigator.getGamepads = () => (window.__padOn ? [pad] : [])
  })
  const page = await context.newPage()
  page.on('console', (m) => {
    if (m.type() === 'error') report.errors.push(m.text())
  })
  page.on('pageerror', (e) => report.errors.push(String(e)))
  const shot = (name) => page.screenshot({ path: `${SHOTS}/${name}.png` })
  const game = (fn, arg) => page.evaluate(fn, arg)
  const screen = () => game(() => window.ballborn.screen)
  const clearRoom = () => game(() => {
    const g = window.ballborn
    const s = g.sim
    if (!s) return false
    for (const e of s.enemies) s.damageEnemy(e, 1e6, ['impact'], { source: 'collision', kind: 'impact' })
    if (s.boss) {
      for (const r of s.boss.rivets) s.damageEnemy(r, 1e6, ['impact'], { source: 'collision', kind: 'impact' })
      s.damageEnemy(s.boss, 1e7, ['impact'], { source: 'collision', kind: 'impact' })
    }
    s.survivalLeft = 0
    s.exitOpen = true
    const ex = s.room.exit
    s.ball.x = ex.x + ex.w / 2
    s.ball.y = ex.y + ex.h - s.ball.r - 2
    s.ball.vx = s.room.rules?.includes('speed-gate') ? 2000 : 0
    s.ball.vy = 0
    s.boost = 1
    return true
  })
  const waitScreen = async (want, ms = 4000) => {
    const t = Date.now()
    while (Date.now() - t < ms) {
      if (want.includes(await screen())) return true
      await page.waitForTimeout(50)
    }
    return false
  }

  await page.goto(URL)
  await page.waitForTimeout(600)
  check('title renders', (await screen()) === 'title')
  check('keyboard focus starts on a button', await page.evaluate(() => document.activeElement?.tagName === 'BUTTON'))
  await shot('01-title')

  // Tutorial: roll for real, measure frame times while playing.
  await page.click('[data-act="launch"][data-arg="tutorial"]')
  await waitScreen(['play'])
  await page.keyboard.down('KeyD')
  const frames = await page.evaluate(() => new Promise((resolve) => {
    const out = []
    let last = performance.now()
    const end = last + 5000
    const f = (now) => {
      out.push(now - last)
      last = now
      if (now < end) requestAnimationFrame(f)
      else resolve(out)
    }
    requestAnimationFrame(f)
  }))
  await page.keyboard.up('KeyD')
  const sorted = [...frames].sort((a, b) => a - b)
  const pct = (p) => sorted[Math.min(sorted.length - 1, Math.floor((sorted.length * p) / 100))]
  report.perf.tutorialRoll = { frames: frames.length, p50: pct(50), p95: pct(95), p99: pct(99), max: sorted[sorted.length - 1] }
  check('ball moved under keyboard input', await game(() => window.ballborn.sim.ball.x > 200), `x=${await game(() => Math.round(window.ballborn.sim.ball.x))}`)
  await shot('02-tutorial')
  await clearRoom()
  check('tutorial clear reaches the reward screen', await waitScreen(['reward']))
  await page.waitForTimeout(400)
  await shot('03-reward')
  await page.keyboard.press('Digit1')
  check('key 1 takes the first offer and starts room two', await waitScreen(['play']))
  check('Heavy Core fitted', await game(() => window.ballborn.run.ids.core === 'heavy-core'))
  await clearRoom()
  check('tutorial ends on the route map', await waitScreen(['map']))
  await page.waitForTimeout(300)
  await shot('04-map')
  check('map draws route edges', (await page.locator('.map svg line').count()) > 5)

  // Run the route to the end, visiting whatever the map offers.
  const seen = new Set()
  for (let step = 0; step < 80; step++) {
    const s = await screen()
    seen.add(s)
    if (s === 'map') {
      const nodes = page.locator('.node.open')
      if (!(await nodes.count())) break
      await nodes.first().click()
      await page.waitForTimeout(150)
    } else if (s === 'play') {
      if (!seen.has('play-shot')) {
        seen.add('play-shot')
        await page.waitForTimeout(700)
        await shot('05-room')
      }
      const boss = await game(() => window.ballborn.sim?.room.type === 'boss')
      if (boss && !seen.has('boss-shot')) {
        seen.add('boss-shot')
        await page.waitForTimeout(900)
        await shot('09-boss')
      }
      await clearRoom()
      await waitScreen(['reward', 'map', 'victory'])
    } else if (s === 'reward') {
      await page.click('[data-act="offer"][data-arg="0"]')
    } else if (s === 'shop') {
      await game(() => { window.ballborn.run.cinders += 200 })
      await page.click('[data-act="leave-shop"]').catch(() => {})
      if (!seen.has('shop-shot')) {
        seen.add('shop-shot')
      }
    } else if (s === 'event') {
      if (!seen.has('event-shot')) {
        seen.add('event-shot')
        await shot('07-event')
      }
      await page.locator('[data-act="event"]:not([disabled])').first().click()
    } else if (s === 'victory') break
    await page.waitForTimeout(150)
  }
  check('a full route reaches victory', (await screen()) === 'victory')
  await page.waitForTimeout(300)
  await shot('10-victory')
  check('victory summary shows route and damage breakdown', (await page.locator('.summary-grid section').count()) >= 4)

  // Shop screen on its own, with money, for the screenshot and a purchase.
  await game(() => {
    const g = window.ballborn
    g.launch(false)
  })
  await waitScreen(['map'])
  await game(() => {
    const g = window.ballborn
    g.shop = [{ id: 'heal', kind: 'heal', title: 'Patch the shell', detail: 'Restore 50 integrity (45%).', cost: 26, amount: 50, sold: false }, { id: 'c1', kind: 'component', title: 'Armored Shell', detail: 'shell · uncommon.', cost: 36, componentId: 'armored-shell', sold: false }]
    g.run.cinders = 60
    g.screen = 'shop'
    g.refresh()
  })
  await shot('06-shop')
  await page.click('[data-act="buy"][data-arg="c1"]')
  check('shop purchase fits the part and charges the shown price', await game(() => window.ballborn.run.ids.shell === 'armored-shell' && window.ballborn.run.cinders === 24))

  // Death.
  await game(() => window.ballborn.toMap())
  await page.locator('.node.open').first().click()
  if ((await screen()) === 'play') {
    await game(() => {
      const s = window.ballborn.sim
      s.hp = 1
      s.hurtLock = 0
      s.phase = 0
      s.hurt(50, 'projectile')
    })
    check('death reaches the summary', await waitScreen(['death']))
    await page.waitForTimeout(300)
    await shot('11-death')
    check('death summary names the cause', (await page.locator('text=Cause:').count()) > 0)
  }

  // Settings, codex, lab.
  await game(() => window.ballborn.goTitle())
  await page.click('[data-act="settings"]')
  await page.waitForTimeout(200)
  await shot('12-settings')
  await page.keyboard.press('Escape')
  check('Escape backs out of settings', (await screen()) === 'title')
  await page.click('[data-act="codex"]')
  await page.waitForTimeout(200)
  await shot('13-codex')
  await page.keyboard.press('Escape')
  await page.click('[data-act="lab"]')
  await page.keyboard.down('KeyD')
  await page.waitForTimeout(1200)
  await page.keyboard.up('KeyD')
  await shot('14-lab')
  await page.keyboard.press('Escape')
  await page.waitForTimeout(150)
  check('Escape pauses the lab for editing', await game(() => window.ballborn.labPaused))

  // Controller-only: navigate the title with the fake pad.
  await game(() => window.ballborn.goTitle())
  await page.evaluate(() => { window.__padOn = true })
  const press = async (i) => {
    await page.evaluate((b) => { window.__pad.buttons[b].pressed = true }, i)
    await page.waitForTimeout(80)
    await page.evaluate((b) => { window.__pad.buttons[b].pressed = false }, i)
    await page.waitForTimeout(80)
  }
  const before = await page.evaluate(() => document.activeElement?.textContent?.trim())
  await press(13)
  const after = await page.evaluate(() => document.activeElement?.textContent?.trim())
  check('controller d-pad moves menu focus', before !== after, `${before} -> ${after}`)
  await press(0)
  check('controller A activates the focused button', (await screen()) !== 'title', await screen())
  await press(1)
  await page.evaluate(() => { window.__padOn = false })

  // Focus loss pauses a room.
  await game(() => window.ballborn.goTitle())
  await page.click('[data-act="launch"][data-arg="tutorial"]')
  await waitScreen(['play'])
  await page.evaluate(() => window.dispatchEvent(new Event('blur')))
  check('focus loss pauses the room', (await screen()) === 'pause')

  // Layout at the required sizes and zoom levels. Zoom is emulated as a smaller CSS viewport at a higher device scale.
  const sizes = [
    { name: '1280x720', width: 1280, height: 720, scale: 1 },
    { name: '1920x1080', width: 1920, height: 1080, scale: 1 },
    { name: '800x600', width: 800, height: 600, scale: 1 },
    { name: '1280x720@125%', width: 1024, height: 576, scale: 1.25 },
    { name: '1280x720@150%', width: 853, height: 480, scale: 1.5 },
  ]
  for (const size of sizes) {
    const ctx = await browser.newContext({ viewport: { width: size.width, height: size.height }, deviceScaleFactor: size.scale })
    const p = await ctx.newPage()
    await p.goto(URL)
    await p.waitForTimeout(300)
    for (const view of ['title', 'map', 'reward', 'settings']) {
      await p.evaluate((v) => {
        const g = window.ballborn
        if (v === 'title') return g.goTitle()
        if (!g.run) g.launch(false)
        if (v === 'map') return g.toMap()
        if (v === 'reward') return g.showOffers('elite')
        g.returnTo = 'title'
        g.screen = 'settings'
        g.refresh()
      }, view)
      await p.waitForTimeout(150)
      const res = await p.evaluate(() => {
        const vw = innerWidth
        const vh = innerHeight
        const bad = []
        for (const el of document.querySelectorAll('#screen button, #screen select, #screen input')) {
          const r = el.getBoundingClientRect()
          if (r.width === 0) continue
          // Controls may sit below the fold inside a scrolling panel; they must never be cut off sideways or unreachable.
          let scroller = el.parentElement
          while (scroller && !(scroller.scrollHeight > scroller.clientHeight + 2 && getComputedStyle(scroller).overflowY !== 'visible' && getComputedStyle(scroller).overflowY !== 'hidden')) scroller = scroller.parentElement
          const sideways = r.left < -1 || r.right > vw + 1
          const scrollerX = scroller && (scroller.scrollWidth > scroller.clientWidth + 2)
          const below = r.bottom > vh + 1 && !scroller
          if ((sideways && !scrollerX && !el.closest('.map-scroll')) || below) bad.push(el.textContent?.trim().slice(0, 30) || el.tagName)
        }
        return { bad }
      })
      report.layout.push({ size: size.name, view, clipped: res.bad })
      if (view === 'reward' || view === 'map') await p.screenshot({ path: `${SHOTS}/layout-${size.name.replace(/[@%]/g, '_')}-${view}.png` })
    }
    await ctx.close()
  }
  const clipped = report.layout.filter((l) => l.clipped.length)
  check('no unreachable or sideways-clipped controls at any tested size', clipped.length === 0, clipped.map((c) => `${c.size}/${c.view}: ${c.clipped.join(', ')}`).join('; '))

  // Soak: real-time render in the lab, then accelerated lab simulation for the full duration.
  const soakPage = await context.newPage()
  await soakPage.goto(URL)
  await soakPage.click('[data-act="lab"]')
  await soakPage.keyboard.down('KeyD')
  const realtime = await soakPage.evaluate(() => new Promise((resolve) => {
    const out = []
    let last = performance.now()
    const end = last + 60000
    const f = (now) => {
      out.push(now - last)
      last = now
      const g = window.ballborn
      if (Math.floor(now / 700) % 2) g.sim.step({ x: 0, y: 0, hopHeld: false, hopPressed: true, abilityPressed: true, pausePressed: false, buildPressed: false, confirmPressed: false, mx: 0, my: 0, mouseThrust: false })
      if (now < end) requestAnimationFrame(f)
      else resolve({ frames: out, voices: g.audio.activeVoices, particles: g.sim.particles.length, enemies: g.sim.enemies.length })
    }
    requestAnimationFrame(f)
  }))
  await soakPage.keyboard.up('KeyD')
  const rs = [...realtime.frames].sort((a, b) => a - b)
  report.perf.labRealtime60s = { frames: rs.length, p50: rs[Math.floor(rs.length * 0.5)], p95: rs[Math.floor(rs.length * 0.95)], p99: rs[Math.floor(rs.length * 0.99)], max: rs[rs.length - 1], particles: realtime.particles, enemies: realtime.enemies, voices: realtime.voices }
  // CPU cost of one game frame (simulation + canvas + HUD), ordinary lab and a stress encounter.
  const cost = await soakPage.evaluate(() => new Promise((resolve) => {
    const g = window.ballborn
    const costs = { ordinary: [], stress: [] }
    let bucket = 'ordinary'
    const orig = g.frame.bind(g)
    g.frame = (dt, now) => {
      const t = performance.now()
      orig(dt, now)
      costs[bucket].push(performance.now() - t)
    }
    setTimeout(() => {
      bucket = 'stress'
      const s = g.sim
      const ids = ['grunt', 'bolt', 'spark', 'splitter', 'cask', 'shield']
      for (let i = 0; i < 14; i++) s.enemies.push(s.makeEnemy(ids[i % ids.length], 300 + i * 100, 400, false, 1))
      const timer = setInterval(() => s.explode(s.ball.x + 80, s.ball.y, 160, 5, false), 300)
      setTimeout(() => {
        clearInterval(timer)
        g.frame = orig
        const stat = (a) => {
          const x = [...a].sort((p, q) => p - q)
          return { frames: x.length, p50: x[Math.floor(x.length * 0.5)], p95: x[Math.floor(x.length * 0.95)], p99: x[Math.floor(x.length * 0.99)], max: x[x.length - 1] }
        }
        resolve({ ordinary: stat(costs.ordinary), stress: stat(costs.stress), stressEntities: s.enemies.length, stressParticles: s.particles.length })
      }, 15000)
    }, 10000)
  }))
  report.perf.frameCostMs = cost
  const accel = await soakPage.evaluate((minutes) => {
    const g = window.ballborn
    const s = g.sim
    const ticks = minutes * 60 * 120
    const samples = []
    const heap0 = performance.memory?.usedJSHeapSize ?? 0
    const t0 = performance.now()
    for (let i = 0; i < ticks; i++) {
      const phase = Math.floor(i / 240) % 4
      s.step({ x: phase < 2 ? 1 : -1, y: 0, hopHeld: phase === 1, hopPressed: i % 97 === 0, abilityPressed: i % 180 === 0, pausePressed: false, buildPressed: false, confirmPressed: false, mx: 0, my: 0, mouseThrust: false })
      if (i % (120 * 60) === 0) samples.push({ minute: i / 7200, enemies: s.enemies.length, particles: s.particles.length, bullets: s.bullets.length, pickups: s.pickups.length, floaters: s.floaters.length })
    }
    return { simMinutes: minutes, wallSeconds: (performance.now() - t0) / 1000, perTickMs: (performance.now() - t0) / ticks, heapDeltaMB: ((performance.memory?.usedJSHeapSize ?? 0) - heap0) / 1e6, samples }
  }, SOAK_MIN)
  report.soak = accel
  const last = accel.samples[accel.samples.length - 1]
  check(`lab soak (${SOAK_MIN} simulated minutes) keeps entity counts bounded`, last.enemies <= 12 && last.particles <= 420 && last.bullets < 80 && last.pickups < 200, JSON.stringify(last))
  check('no console errors', report.errors.length === 0, report.errors.slice(0, 3).join(' | '))
} finally {
  await browser.close()
  server.kill()
}
writeFileSync(`${SHOTS}/smoke-report.json`, JSON.stringify(report, null, 2))
console.log(JSON.stringify(report.perf, null, 2))
const failed = report.checks.filter((c) => !c.ok)
console.log(`${report.checks.length - failed.length}/${report.checks.length} checks passed`)
process.exit(failed.length ? 1 : 0)
