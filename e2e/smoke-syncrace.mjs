import { chromium } from 'playwright'

// 서버 저장 직렬화 회귀 — PUT이 느린 동안 연속 편집이 자기 자신과 409로 충돌해
// 두 번째 편집이 유실되던 버그(혼자 쓰는데 '충돌' 토스트)가 되살아나지 않는지.
// 전제: 백엔드 켬(빈 DB 불필요 — 활성 보드에 카드 2장을 추가하고 검증만 한다), 프론트 5175.
const BASE = 'http://localhost:5175'
let failures = 0

function check(name, cond, extra = '') {
  console.log(`${cond ? 'PASS' : 'FAIL'}: ${name}${extra ? ` — ${extra}` : ''}`)
  if (!cond) failures++
}

const TAG = Math.random().toString(36).slice(2, 7)
const CARD_A = `경쟁A-${TAG}`
const CARD_B = `경쟁B-${TAG}`

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } })
page.on('pageerror', (e) => {
  console.log(`PAGE ERROR: ${e.message}`)
  failures++
})
const puts = []
page.on('request', (r) => {
  if (r.url().includes('/api/workspace') && r.method() === 'PUT') puts.push(1)
})

await page.goto(BASE)
await page.waitForSelector('.column, .add-column-btn', { timeout: 30000 })
await page.evaluate(() => localStorage.clear())
await page.reload()
await page.waitForSelector('.column, .add-column-btn', { timeout: 30000 })
await page.waitForTimeout(2000) // 초기 동기화(마이그레이션/pull) 정착
// 서버에서 받은 보드에 컬럼이 없을 수도 있으므로 보장
if ((await page.locator('.column').count()) === 0) {
  await page.locator('.add-column-btn').click()
  await page.locator('.column-composer input').first().fill('경쟁용')
  await page.keyboard.press('Enter')
  await page.keyboard.press('Escape')
  await page.waitForSelector('.column', { timeout: 10000 })
  await page.waitForTimeout(1000)
}

// 준비 단계(컬럼 생성 등)의 PUT은 세지 않는다 — 경쟁 구간만 계수
puts.length = 0

// 배포 환경에서 실측된 느린 PUT(0.1~1.4초)을 1.5초 지연으로 재현
await page.route('**/api/workspace', async (route) => {
  if (route.request().method() === 'PUT') await new Promise((r) => setTimeout(r, 1500))
  await route.continue()
})

const col = page.locator('.column').first()
await col.getByRole('button', { name: /카드 추가/ }).first().click()
const ta = col.locator('textarea').first()
// t=0: 편집 A → 400ms 뒤 PUT1이 1.5초 비행
await ta.fill(CARD_A)
await ta.press('Enter')
// t=+700ms: PUT1 비행 중에 편집 B — 직렬화가 없으면 낡은 baseVersion으로 나가 409
await page.waitForTimeout(700)
await ta.fill(CARD_B)
await ta.press('Enter')
await page.keyboard.press('Escape')

await page.waitForTimeout(5500) // 두 PUT(각 1.5초) + 여유

check('혼자 쓰는데 충돌 토스트가 뜨지 않음', (await page.locator('.toast', { hasText: '충돌' }).count()) === 0)
check('두 번째 편집이 화면에 유지', (await page.locator('.card', { hasText: CARD_B }).count()) === 1)
const server = await page.evaluate(() => fetch('/api/workspace').then((r) => (r.ok ? r.json() : null)))
const json = server ? JSON.stringify(server.workspace) : ''
check('편집 A 서버 반영', json.includes(CARD_A))
check('편집 B 서버 반영 (유실 없음)', json.includes(CARD_B))
check('불필요한 409 왕복 없음 (PUT 2회)', puts.length === 2, `${puts.length}회`)

await browser.close()
console.log(failures === 0 ? '\n모든 검사 통과' : `\n실패 ${failures}건`)
process.exit(failures ? 1 : 0)
