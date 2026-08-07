import { chromium } from 'playwright'

// 로그인 — 전제: 백엔드를 APP_AUTH_PASSWORD=test-pw 로 기동, 프론트 개발 서버 5175.
//   cd backend && APP_AUTH_PASSWORD=test-pw ./gradlew bootRun
// 다른 스위트들과 달리 인증을 켠 상태를 전제로 하므로 단독으로 실행하세요.
const BASE = 'http://localhost:5175'
const API = 'http://localhost:8080'
const PASSWORD = 'test-pw'
let failures = 0

function check(name, cond, extra = '') {
  console.log(`${cond ? 'PASS' : 'FAIL'}: ${name}${extra ? ` — ${extra}` : ''}`)
  if (!cond) failures++
}

async function login(page) {
  await page.waitForSelector('.login-card', { timeout: 25000 })
  await page.locator('.login-input').nth(1).fill(PASSWORD)
  await page.getByRole('button', { name: /로그인/ }).click()
  await page.waitForSelector('.column', { timeout: 25000 })
}

// 사전 확인: 백엔드가 인증을 켠 상태인가
const me = await fetch(`${API}/api/auth/me`).then((r) => r.json())
if (!me.required) {
  console.log('SKIP: 백엔드가 인증 꺼짐 상태입니다. APP_AUTH_PASSWORD=test-pw 로 기동 후 실행하세요.')
  process.exit(0)
}

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1300, height: 850 } })
page.on('pageerror', (e) => {
  console.log(`PAGE ERROR: ${e.message}`)
  failures++
})

// ── 서버 차단이 실제로 되는가 (프론트 화면만 잠그면 여기서 걸린다)
for (const path of ['/api/notes', '/api/diagrams', '/api/workspace/version']) {
  const status = await fetch(`${API}${path}`).then((r) => r.status)
  check(`로그인 전 ${path} 차단`, status === 401, `HTTP ${status}`)
}

await page.goto(BASE)
await page.waitForSelector('.login-card', { timeout: 25000 })
check('로그인 화면 표시', true)
check('로그인 전 보드 미마운트', (await page.locator('.column').count()) === 0)

// ── 잘못된 자격증명
await page.locator('.login-input').nth(1).fill('wrong-password')
await page.getByRole('button', { name: /로그인/ }).click()
await page.waitForSelector('.login-error', { timeout: 15000 })
check('오답 시 오류 표시 + 화면 유지', await page.locator('.login-card').isVisible())

// ── 정상 로그인
await page.locator('.login-input').nth(1).fill(PASSWORD)
await page.getByRole('button', { name: /로그인/ }).click()
await page.waitForSelector('.column', { timeout: 25000 })
check('로그인 성공 → 보드 진입', true)
check('로그아웃 버튼 노출', await page.getByRole('button', { name: '로그아웃' }).isVisible())

await page.reload()
await page.waitForSelector('.column', { timeout: 25000 })
check('새로고침 후 세션 유지', (await page.locator('.login-card').count()) === 0)

// ── 감춰진 페이지도 로그인 없이는 못 들어간다
await page.goto(`${BASE}/memo`)
await page.waitForSelector('.memo-textarea', { timeout: 25000 })
check('로그인 상태에서 /memo 접근', (await page.locator('.memo-error').count()) === 0)

// ── 세션이 끊기면 즉시 로그인 화면으로 돌아가야 한다.
// 이걸 놓치면 앱이 계속 떠 있는 채 변경이 localStorage에만 쌓여 서버와 어긋난다
// (사용자는 저장된 줄 알지만 다른 기기에는 반영되지 않는다).
await page.goto(BASE)
await page.waitForSelector('.column', { timeout: 25000 })
await page.evaluate(() => fetch('/api/auth/logout', { method: 'POST' })) // 세션 강제 만료
await page.evaluate(() => fetch('/api/notes')) // 401을 유발
await page
  .waitForSelector('.login-card', { timeout: 20000 })
  .then(() => check('세션 만료 감지 → 로그인 화면 복귀', true))
  .catch(() => check('세션 만료 감지 → 로그인 화면 복귀', false, '보드가 그대로 떠 있음'))
check('만료 후 보드 미노출', (await page.locator('.column').count()) === 0)

// ── 로그아웃 버튼
await login(page)
await page.getByRole('button', { name: '로그아웃' }).click()
await page.waitForSelector('.login-card', { timeout: 20000 })
check('로그아웃 → 로그인 화면', true)
const afterLogout = await fetch(`${API}/api/notes`).then((r) => r.status)
check('로그아웃 후 API 차단', afterLogout === 401, `HTTP ${afterLogout}`)

await browser.close()
console.log(failures === 0 ? '\n모든 검사 통과' : `\n실패 ${failures}건`)
process.exit(failures ? 1 : 0)
