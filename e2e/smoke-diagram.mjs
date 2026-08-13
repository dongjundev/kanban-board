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

// 겹친 엣지 라벨 분리 — 양방향 엣지 쌍(A→B, B→A 각각 라벨)은 dagre가 라벨을
// 같은 자리에 두어 상자가 포개진다(실제 BSS 구성도에서 재현된 패턴).
const BIDIR = `graph TD
  A[("Orchestrator DB<br/>SAGA 상태 / 보상 이력")] -->|"Outbox Table 폴링"| P(("Outbox Publisher<br/>커밋 후 즉시발행 + 폴링 백업"))
  B[("Biz Domain1 DB<br/>업무 Table + Outbox Table")] -->|"Outbox Table 폴링"| P
  C[("Biz Domain2 DB<br/>업무 Table + Outbox Table")] -->|"Outbox Table 폴링"| P
  P -. "발행상태 갱신 / 재시도 / 중복방지" .-> A
  P -. "발행상태 갱신 / 재시도 / 중복방지" .-> B
  P -. "발행상태 갱신 / 재시도 / 중복방지" .-> C`
await page.locator('.mermaid-editor').fill(BIDIR)
await page.waitForTimeout(1200)
await page.getByRole('button', { name: '실제 크기' }).click()
await page.waitForTimeout(300)
const labelOverlaps = await page.evaluate(() => {
  const labels = [...document.querySelectorAll('.mermaid-svg g.edgeLabel')]
    .map((el) => ({ t: (el.textContent ?? '').trim(), r: el.getBoundingClientRect() }))
    .filter((l) => l.r.width > 3 && l.r.height > 3 && l.t)
  let count = 0
  for (let i = 0; i < labels.length; i++)
    for (let j = i + 1; j < labels.length; j++) {
      const a = labels[i].r, b = labels[j].r
      if (Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1 &&
          Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1) count++
    }
  return { total: labels.length, count }
})
check('양방향 엣지 라벨이 겹치지 않음', labelOverlaps.total === 6 && labelOverlaps.count === 0, `라벨 ${labelOverlaps.total}개, 겹침 ${labelOverlaps.count}쌍`)

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

// ELK 레이아웃 — frontmatter `layout: elk`로 다이어그램별 선택. 로더 등록이 깨져도
// mermaid는 콘솔 경고만 남기고 dagre로 조용히 폴백해 화면상 오류가 없으므로,
// "폴백 경고 부재 + 노드 위치가 dagre와 다름"으로 실제 적용을 확인한다.
const ELK_GRAPH = `flowchart TD
  A[요청] --> B{인증}
  B -->|성공| C[핸들러]
  B -->|실패| D[401 응답]
  C --> E[(DB)]
  E --> F[응답]
  A -->|캐시 적중| F
  F --> A`
const posOf = () =>
  page.evaluate(() =>
    Object.fromEntries(
      [...document.querySelectorAll('.mermaid-svg .node')].map((n) => {
        const r = n.getBoundingClientRect()
        return [(n.textContent ?? '').trim(), [Math.round(r.x), Math.round(r.y)]]
      }),
    ),
  )
const renderWith = async (source) => {
  const prev = await page.locator('.mermaid-svg svg').getAttribute('id')
  await page.locator('.mermaid-editor').fill(source)
  await page.waitForFunction((p) => document.querySelector('.mermaid-svg svg')?.getAttribute('id') !== p, prev, {
    timeout: 30000, // 첫 ELK 렌더는 elkjs 청크 다운로드를 포함한다
  })
  await page.waitForTimeout(300)
}
await renderWith(ELK_GRAPH)
const dagrePos = await posOf()
const elkWarnings = []
page.on('console', (m) => {
  const t = m.text()
  // 'not found'만 보면 무관한 리소스 404("404 (Not Found)")에도 걸려 오탐이 난다
  // — 레이아웃 문맥(elk/layout/dagre)이 함께 있는 메시지만 폴백 경고로 취급
  if (/elk|layout|dagre/i.test(t) && /fall.?back|not (registered|found|supported)/i.test(t)) elkWarnings.push(t)
})
await renderWith(`---\nconfig:\n  layout: elk\n---\n${ELK_GRAPH}`)
check('ELK frontmatter 문법 오류 없음', (await page.locator('.mermaid-error').count()) === 0)
const elkPos = await posOf()
check('ELK 레이아웃 렌더', Object.keys(elkPos).length >= 6, `노드 ${Object.keys(elkPos).length}개`)
check('ELK 적용 (dagre 폴백 경고 없음)', elkWarnings.length === 0, elkWarnings[0] ?? '')
const movedNodes = Object.keys(dagrePos).filter((k) => {
  const [ax, ay] = dagrePos[k]
  const [bx, by] = elkPos[k] ?? [ax, ay]
  return Math.abs(ax - bx) > 5 || Math.abs(ay - by) > 5
})
check('ELK 레이아웃이 dagre와 다름', movedNodes.length > 0, `이동 노드 ${movedNodes.length}개`)

// ELK 모듈 로드 실패 격리 — 등록용 import 실패가 mermaid 전체 실패로 승격되면
// ELK와 무관한 차트까지 렌더 불능이 된다(과거 버그). 진입 모듈을 차단해도
// 일반 차트는 렌더되고, ELK 지정 차트는 dagre 폴백으로 살아야 한다.
{
  const ctx2 = await browser.newContext()
  await ctx2.route('**/@mermaid-js_layout-elk*', (r) => r.abort())
  const p2 = await ctx2.newPage()
  await p2.goto(`${BASE}/diagram`)
  await p2.evaluate(() => localStorage.removeItem('kanban-mermaid-draft'))
  await p2.reload()
  await p2.waitForSelector('.mermaid-editor', { timeout: 30000 })
  await p2.locator('.mermaid-editor').fill('graph TD\n  A[하나] --> B[둘]')
  const alive = await p2
    .waitForSelector('.mermaid-svg svg', { timeout: 15000 })
    .then(() => true)
    .catch(() => false)
  check('ELK 모듈 로드 실패에도 일반 차트 렌더 생존', alive)
  await p2.locator('.mermaid-editor').fill('---\nconfig:\n  layout: elk\n---\ngraph TD\n  A[하나] --> B[둘] --> C[셋]')
  await p2.waitForTimeout(2000)
  check('ELK 지정 차트는 dagre 폴백으로 렌더', (await p2.locator('.mermaid-svg svg').count()) === 1)
  await ctx2.close()
}

// 저장 차트 불러오기 피드백 — 이전 차트가 새 차트 렌더 완료까지 계속 보이면 클릭이
// 무시된 것처럼 보인다. 불러오기는 미리보기를 비워 '렌더링 중…'을 띄우고 디바운스 없이
// 그린다(타이핑 중 미리보기 유지와 구분). 같은 차트 재클릭은 code state가 그대로라
// 렌더 효과가 다시 돌지 않으므로 지우면 안 된다(지우면 '렌더링 중…'에 영영 멈춘다).
{
  const ctx3 = await browser.newContext()
  const big = ['graph TD']
  for (let i = 0; i < 50; i++) big.push(`  S${i}["저장 노드 ${i}"] -->|"연결 ${i}"| S${(i * 13 + 5) % 50}`)
  await ctx3.route('**/api/diagrams', (r) =>
    r.fulfill({
      json: [
        { id: 1, title: '큰 차트', code: big.join('\n'), updatedAt: '2026-08-13T12:00:00Z' },
        { id: 2, title: '작은 차트', code: 'graph TD\n  A[하나] --> B[둘]', updatedAt: '2026-08-13T11:00:00Z' },
      ],
    }),
  )
  const p3 = await ctx3.newPage()
  await p3.goto(`${BASE}/diagram`)
  await p3.evaluate(() => localStorage.removeItem('kanban-mermaid-draft'))
  await p3.reload()
  await p3.waitForSelector('.mermaid-svg svg', { timeout: 30000 })
  // 렌더가 메인스레드를 점유하는 동안 외부 폴링은 못 끼어들므로 페이지 안 관찰자로 기록
  await p3.evaluate(() => {
    window.__sawLoading = false
    new MutationObserver(() => {
      const el = document.querySelector('.mermaid-preview .memo-empty')
      if (el && (el.textContent ?? '').includes('렌더링 중') && !document.querySelector('.mermaid-svg'))
        window.__sawLoading = true
    }).observe(document.querySelector('.mermaid-preview'), { childList: true, subtree: true })
  })
  await p3.locator('.mermaid-saved-load', { hasText: '큰 차트' }).click()
  await p3.waitForSelector('.mermaid-svg svg', { timeout: 30000 })
  check("차트 불러오기 시 '렌더링 중…' 표시", await p3.evaluate(() => window.__sawLoading))
  await p3.locator('.mermaid-saved-load', { hasText: '큰 차트' }).click()
  await p3.waitForTimeout(800)
  check('같은 차트 재클릭 시 미리보기 유지', (await p3.locator('.mermaid-svg svg').count()) === 1)
  await ctx3.close()
}

await browser.close()
console.log(failures === 0 ? '\n모든 검사 통과' : `\n실패 ${failures}건`)
process.exit(failures ? 1 : 0)
