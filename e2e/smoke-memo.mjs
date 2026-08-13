import { chromium } from 'playwright'

// 메모 저장 — 낙관적 반영(즉시)·실패 복원·중복 방지·대용량 왕복.
// 전제: 백엔드 켬(빈 DB 불필요 — 자기가 만든 메모만 만들고 지운다), 프론트 5175.
const BASE = 'http://localhost:5175'
const API = 'http://localhost:8080'
let failures = 0

function check(name, cond, extra = '') {
  console.log(`${cond ? 'PASS' : 'FAIL'}: ${name}${extra ? ` — ${extra}` : ''}`)
  if (!cond) failures++
}

// 이 스위트가 만든 메모만 식별해 지우기 위한 고유 접두사
const TAG = `메모E2E-${Math.random().toString(36).slice(2, 7)}`
const serverNotes = async () =>
  (await fetch(`${API}/api/notes`).then((r) => r.json())).filter((n) => n.content.startsWith(TAG))

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1300, height: 850 } })
page.on('pageerror', (e) => {
  console.log(`PAGE ERROR: ${e.message}`)
  failures++
})

await page.goto(`${BASE}/memo`)
await page.waitForSelector('.memo-textarea', { timeout: 30000 })

// ── 1. 낙관적 저장: 서버가 1.5초 걸려도 입력칸은 즉시 비워지고 항목이 바로 보인다.
// 배포 VM은 응답이 수백 ms~수 초까지 흔들리므로, 왕복을 기다리면 저장이 멈춘 것처럼 느껴진다.
await page.route('**/api/notes', async (route) => {
  if (route.request().method() === 'POST') await new Promise((r) => setTimeout(r, 1500))
  await route.continue()
})
await page.locator('.memo-textarea').fill(`${TAG} 낙관적 저장`)
const t0 = Date.now()
await page.getByRole('button', { name: '저장' }).click()
await page.waitForFunction(() => document.querySelector('.memo-textarea').value === '', null, { timeout: 5000 })
const cleared = Date.now() - t0
check('저장 클릭 즉시 입력칸 비움 (서버 1.5초 지연 중)', cleared < 800, `${cleared}ms`)
check('임시 항목이 목록에 즉시 표시', (await page.locator('.memo-item.pending', { hasText: '낙관적 저장' }).count()) === 1)
check('임시 항목에는 삭제 버튼 없음', (await page.locator('.memo-item.pending .memo-icon-btn').count()) === 0)
// 서버 응답이 오면 pending이 풀리고 실제 시각이 붙는다
await page.waitForFunction(() => !document.querySelector('.memo-item.pending'), null, { timeout: 10000 })
check('서버 확인 후 pending 해제', true)
check('서버에 실제 저장됨', (await serverNotes()).some((n) => n.content.includes('낙관적 저장')))
await page.unroute('**/api/notes')

// ── 2. 실패 시 복원: 항목을 걷어내고 내용을 입력칸에 되돌린다 (유실 없음)
await page.route('**/api/notes', async (route) => {
  if (route.request().method() === 'POST') return route.abort()
  await route.continue()
})
const FAIL_TEXT = `${TAG} 실패해야 하는 메모`
await page.locator('.memo-textarea').fill(FAIL_TEXT)
await page.getByRole('button', { name: '저장' }).click()
await page.waitForSelector('.memo-error', { timeout: 10000 })
check('실패 시 오류 안내 표시', (await page.locator('.memo-error').innerText()).includes('되돌렸습니다'))
check('실패 시 입력칸에 내용 복원', (await page.locator('.memo-textarea').inputValue()) === FAIL_TEXT)
check('실패한 임시 항목은 목록에서 제거', (await page.locator('.memo-item', { hasText: '실패해야 하는' }).count()) === 0)
check('서버에도 저장 안 됨', !(await serverNotes()).some((n) => n.content.includes('실패해야')))
await page.unroute('**/api/notes')

// ── 3. ⌘/Ctrl+Enter 연타(키 자동반복)에도 한 건만 저장 — 같은 tick의 연속 이벤트는
// 리렌더 전의 낡은 state를 보므로, 동기적으로 비워지는 ref가 없으면 여러 벌 저장된다
await page.locator('.memo-textarea').fill(`${TAG} 연타 메모`)
await page.evaluate(() => {
  const el = document.querySelector('.memo-textarea')
  for (let i = 0; i < 10; i++)
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true }))
})
await page.waitForFunction(() => !document.querySelector('.memo-item.pending'), null, { timeout: 10000 })
const dupes = (await serverNotes()).filter((n) => n.content.includes('연타 메모'))
check('Ctrl+Enter 10연타 → 서버에 1건만', dupes.length === 1, `${dupes.length}건`)

// ── 4. 붙여넣은 빌드 로그 크기(20KB·역슬래시 경로 포함)가 온전히 왕복되는가
const LOG = `${TAG} 로그\n` + Array.from({ length: 115 }, (_, i) => `[INFO] Installing D:\\dev\\repo\\module-${i}\\target\\m-${i}.jar to C:\\maven\\repository\\m${i}.jar`).join('\n')
await page.locator('.memo-textarea').fill(LOG)
await page.getByRole('button', { name: '저장' }).click()
await page.waitForFunction(() => !document.querySelector('.memo-item.pending'), null, { timeout: 15000 })
const onServer = (await serverNotes()).find((n) => n.content.includes(`${TAG} 로그`))
check('20KB 로그 저장·내용 일치', onServer?.content === LOG, `${onServer ? onServer.content.length : 0}자`)

// ── 5. 한글 IME 조합 중 Ctrl+Enter는 저장하지 않는다 (조합 확정 Enter 중복 제출 방지)
await page.locator('.memo-textarea').fill(`${TAG} 조합중`)
await page.evaluate(() => {
  const el = document.querySelector('.memo-textarea')
  el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, isComposing: true, bubbles: true }))
})
await page.waitForTimeout(600)
check('조합 중 Ctrl+Enter는 저장 안 됨', !(await serverNotes()).some((n) => n.content.includes('조합중')))
check('조합 중 입력칸 유지', (await page.locator('.memo-textarea').inputValue()).includes('조합중'))

// ── 6. 삭제 정상 동작 + 뒷정리 (이 스위트가 만든 것만)
await page.reload()
await page.waitForSelector('.memo-textarea', { timeout: 30000 })
const mine = await serverNotes()
for (const n of mine) {
  await fetch(`${API}/api/notes/${n.id}`, { method: 'DELETE' })
}
check('뒷정리: 이 스위트의 메모 삭제', (await serverNotes()).length === 0, `${mine.length}건 정리`)

await browser.close()
console.log(failures === 0 ? '\n모든 검사 통과' : `\n실패 ${failures}건`)
process.exit(failures ? 1 : 0)
