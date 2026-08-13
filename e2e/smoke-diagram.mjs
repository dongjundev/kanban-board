import { chromium } from 'playwright'

// 다이어그램(mermaid) 페이지 — 렌더·테마 연동·글자색 대비·확대/이동.
// 전제: 백엔드 불필요(저장 기능은 다루지 않음), 프론트 개발 서버 5175.
const BASE = 'http://localhost:5175'
let failures = 0

function check(name, cond, extra = '') {
  console.log(`${cond ? 'PASS' : 'FAIL'}: ${name}${extra ? ` — ${extra}` : ''}`)
  if (!cond) failures++
}

/** WCAG 상대 휘도 */
function luminance([r, g, b]) {
  const f = (c) => {
    const s = c / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
}
const rgb = (s) => (String(s).match(/\d+(\.\d+)?/g) ?? []).slice(0, 3).map(Number)
function contrast(a, b) {
  const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (l1 + 0.05) / (l2 + 0.05)
}

/** 모든 노드의 (배경, 글자) 대비 중 최솟값 */
async function worstContrast(page) {
  const rows = await page.evaluate(() =>
    [...document.querySelectorAll('.mermaid-svg .node')].map((n) => {
      const shape = n.querySelector('.label-container') ?? n.querySelector('rect, polygon, ellipse, circle, path')
      const label = n.querySelector('.nodeLabel')
      if (!shape || !label) return null
      const cs = getComputedStyle(label)
      return {
        bg: getComputedStyle(shape).fill,
        fg: cs.color !== 'rgba(0, 0, 0, 0)' ? cs.color : cs.fill,
        text: (label.textContent ?? '').trim().slice(0, 12),
      }
    }),
  )
  let worst = { ratio: Infinity, text: '' }
  for (const r of rows) {
    if (!r) continue
    const bg = rgb(r.bg)
    const fg = rgb(r.fg)
    if (bg.length < 3 || fg.length < 3) continue
    const ratio = contrast(bg, fg)
    if (ratio < worst.ratio) worst = { ratio, text: r.text }
  }
  return worst
}

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1200, height: 800 } })
page.on('pageerror', (e) => {
  console.log(`PAGE ERROR: ${e.message}`)
  failures++
})

// style/classDef로 직접 칠한 밝은 노드 — 다크 모드에서 흰 글씨가 겹치던 케이스
const CODE = `flowchart TD
  A[기본 노드] --> B{{밝은 육각형}}
  B --> C[흰 사각형]
  B --> D((연노랑 원))
  C --> E[진한 파랑]
  style B fill:#fff4e6,stroke:#f97316
  style C fill:#ffffff
  style D fill:#fef9c3
  style E fill:#123a6b`

for (const theme of ['dark', 'light']) {
  await page.goto(`${BASE}/diagram`)
  await page.evaluate((t) => {
    localStorage.setItem('kanban-board-theme', t)
    localStorage.removeItem('kanban-mermaid-draft')
    localStorage.setItem('kanban-mermaid-split', '30')
  }, theme)
  await page.reload()
  await page.waitForSelector('.mermaid-editor', { timeout: 30000 })
  await page.locator('.mermaid-editor').fill(CODE)
  await page.waitForSelector('.mermaid-svg svg', { timeout: 30000 })
  await page.waitForTimeout(1200)

  const initial = await worstContrast(page)
  check(`[${theme}] 직접 칠한 노드도 글자 대비 4.5:1 이상`, initial.ratio >= 4.5, `최저 ${initial.ratio.toFixed(2)}:1 "${initial.text}"`)

  // 회귀 방지: 확대·이동 후에도 글자색이 유지되어야 한다.
  // 렌더 후 DOM을 고치는 방식이면 리렌더로 인라인 스타일이 날아가 여기서 걸린다.
  await page.getByRole('button', { name: '확대' }).click()
  await page.waitForTimeout(250)
  const afterZoom = await worstContrast(page)
  check(`[${theme}] 확대 후에도 대비 유지`, afterZoom.ratio >= 4.5, `최저 ${afterZoom.ratio.toFixed(2)}:1 "${afterZoom.text}"`)

  const box = await page.locator('.mermaid-preview').boundingBox()
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.wheel(0, -400)
  await page.waitForTimeout(300)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width / 2 + 60, box.y + box.height / 2 + 30, { steps: 5 })
  await page.mouse.up()
  await page.waitForTimeout(300)
  const afterPan = await worstContrast(page)
  check(`[${theme}] 휠 줌·드래그 후에도 대비 유지`, afterPan.ratio >= 4.5, `최저 ${afterPan.ratio.toFixed(2)}:1 "${afterPan.text}"`)
}

// 확대 상한 (MAX_SCALE) — 조작으로 상한까지 올라가고 그 이상은 멈춘다
await page.goto(`${BASE}/diagram`)
await page.waitForSelector('.mermaid-svg svg', { timeout: 30000 })
for (let i = 0; i < 24; i++) await page.getByRole('button', { name: '확대' }).click()
const maxPct = await page.locator('.mermaid-zoom-level').innerText()
check('확대 상한 3000%', maxPct === '3000%', maxPct)
await page.getByRole('button', { name: '실제 크기' }).click()
check('실제 크기 복원', (await page.locator('.mermaid-zoom-level').innerText()) === '100%')

// 큰 차트 시인성 — 화면 맞춤(구조 보기) ↔ 실제 크기(글자 읽기) ↔ 전체 화면
const BIG = 'flowchart LR\n' + Array.from({ length: 30 }, (_, i) => `  N${i}[긴 이름의 처리 단계 ${i}] --> N${i + 1}[다음 단계 ${i + 1}]`).join('\n')
await page.locator('.mermaid-editor').fill(BIG)
await page.waitForTimeout(1200)
await page.getByRole('button', { name: '화면 맞춤' }).click()
const fitPct = parseInt(await page.locator('.mermaid-zoom-level').innerText())
check('큰 차트 화면 맞춤 배율 < 100%', fitPct < 100, `${fitPct}%`)
const svgBox = await page.locator('.mermaid-svg svg').boundingBox()
const paneBox = await page.locator('.mermaid-preview').boundingBox()
check('화면 맞춤 시 차트 전체가 패널 안에', svgBox.width <= paneBox.width + 4 && svgBox.height <= paneBox.height + 4)
await page.getByRole('button', { name: '실제 크기' }).click()
check('실제 크기 = 정직한 100%', (await page.locator('.mermaid-zoom-level').innerText()) === '100%')

// 초안으로 저장된 큰 차트는 새로 열 때 자동 화면 맞춤으로 시작해야 한다
await page.waitForTimeout(700) // 초안 디바운스(300ms) 정착
await page.reload()
await page.waitForSelector('.mermaid-svg svg', { timeout: 30000 })
await page.waitForTimeout(400)
const initialPct = parseInt(await page.locator('.mermaid-zoom-level').innerText())
check('새로 열면 자동 화면 맞춤 (<100%)', initialPct < 100, `${initialPct}%`)

// 전체 화면 — 미리보기가 화면 전체를 덮고 Esc로 나온다
await page.getByRole('button', { name: '전체 화면' }).click()
await page.waitForTimeout(300)
const fsBox = await page.locator('.mermaid-preview').boundingBox()
check('전체 화면이 뷰포트를 덮음', fsBox.width >= 1190 && fsBox.x <= 2, `${Math.round(fsBox.width)}px`)
check('전체 화면 종료 버튼 표시', (await page.getByRole('button', { name: '전체 화면 종료' }).count()) === 1)
await page.keyboard.press('Escape')
await page.waitForTimeout(300)
const backBox = await page.locator('.mermaid-preview').boundingBox()
check('Esc로 전체 화면 종료', backBox.width < 1000, `${Math.round(backBox.width)}px`)

// 테마를 토글하면 미리보기도 즉시 다시 그려진다
await page.goto(`${BASE}/diagram`)
await page.evaluate(() => localStorage.setItem('kanban-board-theme', 'light'))
await page.reload()
await page.waitForSelector('.mermaid-svg svg', { timeout: 30000 })
const beforeId = await page.locator('.mermaid-svg svg').getAttribute('id')
await page.getByRole('button', { name: /모드로 전환/ }).click()
await page
  .waitForFunction((prev) => document.querySelector('.mermaid-svg svg')?.getAttribute('id') !== prev, beforeId, {
    timeout: 15000,
  })
  .then(() => check('테마 토글 시 미리보기 재렌더', true))
  .catch(() => check('테마 토글 시 미리보기 재렌더', false))

await browser.close()
console.log(failures === 0 ? '\n모든 검사 통과' : `\n실패 ${failures}건`)
process.exit(failures ? 1 : 0)
