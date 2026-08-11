import puppeteer from "puppeteer-core"
const URL = "http://127.0.0.1:3101"
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function avatarX(page, txt) {
  try {
    return await page.evaluate((t) => {
      const span = [...document.querySelectorAll("span")].find(
        (s) => s.textContent && s.textContent.includes(t))
      if (!span) return null
      let el = span.parentElement
      while (el && !el.style.transform) el = el.parentElement
      const m = el && /translate\(([-\d.]+)px/.exec(el.style.transform)
      return m ? parseFloat(m[1]) : null
    }, txt)
  } catch { return "ERR" }
}

const browser = await puppeteer.launch({
  executablePath: "/usr/bin/google-chrome-stable",
  headless: true,
  protocolTimeout: 120000,
  args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream",
    "--autoplay-policy=no-user-gesture-required", "--no-sandbox", "--disable-dev-shm-usage"],
})
const logs = []
async function join(page, name, tag) {
  page.on("console", (m) => { if (m.type() === "error") logs.push(`[${tag}] ${m.text()}`) })
  page.on("pageerror", (e) => logs.push(`[${tag}:PAGEERR] ${e.message}`))
  await page.goto(URL, { waitUntil: "domcontentloaded" })
  await page.waitForSelector("#name", { timeout: 20000 })
  await page.type("#name", name)
  await page.click('button[type="submit"]')
}

const a = await browser.newPage()
const b = await browser.newPage()
await join(a, "Alice", "A")
await sleep(500)
await join(b, "Bob", "B")
await sleep(10000)

const start = await avatarX(b, "Alice")
await a.bringToFront()
await a.keyboard.down("ArrowRight")
await sleep(700)
const mid = await avatarX(b, "Alice")
await sleep(800)
await a.keyboard.up("ArrowRight")
await sleep(700)
const aliceEnd = await avatarX(a, "(you)")
const bobEnd = await avatarX(b, "Alice")

console.log(JSON.stringify({
  bobSeesAlice_start: start, bobSeesAlice_mid: mid, bobSeesAlice_end: bobEnd,
  aliceSelf_end: aliceEnd,
  tracked: [start, mid, bobEnd].every((v) => typeof v === "number")
    && bobEnd > start && Math.abs(bobEnd - aliceEnd) < 30,
  rate429: logs.filter((l) => l.includes("429")).length,
  sampleErrs: logs.slice(0, 6),
}, null, 2))
await browser.close()
process.exit(0)
