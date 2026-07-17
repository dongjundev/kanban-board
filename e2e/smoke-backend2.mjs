import { chromium } from 'playwright'

const BASE = 'http://localhost:5175'
const API = 'http://localhost:8080/api/workspace'
let failures = 0

function check(name, cond) {
  console.log(`${cond ? 'PASS' : 'FAIL'}: ${name}`)
  if (!cond) failures++
}

async function serverVersion() {
  return (await (await fetch(`${API}/version`)).json()).version
}
async function serverDoc() {
  return await (await fetch(API)).json()
}

const browser = await chromium.launch()

// ========== [1] PUT 일시 실패 → dirty 복구 + 재시도로 결국 저장됨 ==========
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await ctx.newPage()
  let abortNext = true
  await ctx.route('**/api/workspace', (route) => {
    if (route.request().method() === 'PUT' && abortNext) {
      abortNext = false
      return route.abort()
    }
    return route.continue()
  })
  await page.goto(BASE)
  await page.waitForSelector('.column')
  await page.waitForTimeout(1200)
  const vBefore = await serverVersion()

  const col1 = page.locator('.column').first()
  await col1.locator('.add-card-btn').click()
  await col1.locator('.card-composer textarea').fill('재시도 검증 카드')
  await page.keyboard.press('Enter')
  await page.keyboard.press('Escape')
  // 첫 PUT은 abort → 3초 후 재시도 → 성공까지 대기
  await page.waitForTimeout(5500)
  const vAfter = await serverVersion()
  const doc = await serverDoc()
  check(`PUT 실패 후 자동 재시도로 저장됨 (v${vBefore}→v${vAfter})`, vAfter > vBefore)
  check('재시도된 문서에 카드 존재', JSON.stringify(doc.workspace).includes('재시도 검증 카드'))
  await ctx.close()
}

// ========== [2] 폴링 적용 시 localStorage 미러도 갱신됨 ==========
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await ctx.newPage()
  await page.goto(BASE)
  await page.waitForSelector('.column')
  await page.waitForTimeout(1200)

  // 외부 클라이언트가 보드 제목 변경 (올바른 baseVersion으로)
  const current = await serverDoc()
  const ws = current.workspace
  ws.boards[ws.activeBoardId].boardTitle = '원격마커 보드'
  const putRes = await fetch(API, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ workspace: ws, baseVersion: current.version }),
  })
  check('외부 PUT 성공', putRes.ok)

  await page.waitForFunction(() => document.querySelector('.board-title')?.textContent === '원격마커 보드', { timeout: 10000 }).catch(() => {})
  check('폴링으로 원격 변경 반영', (await page.textContent('.board-title')) === '원격마커 보드')
  const mirror = await page.evaluate(() => localStorage.getItem('kanban-workspace-v1') ?? '')
  check('localStorage 미러에도 반영 (오프라인 캐시 신선)', mirror.includes('원격마커 보드'))
  await ctx.close()
}

// ========== [3] 재조정: 미전송 로컬 변경이 재접속 시 서버로 올라감 ==========
{
  const current = await serverDoc()
  const ws = JSON.parse(JSON.stringify(current.workspace))
  const boardId = ws.activeBoardId
  const colId = ws.boards[boardId].columnOrder[0]
  ws.boards[boardId].cards['recover-1'] = {
    id: 'recover-1', title: '유실복구 카드', description: '', labelIds: [], assignee: '', dueDate: null, createdAt: '2026-07-17T00:00:00.000Z',
  }
  ws.boards[boardId].columns[colId].cardIds.push('recover-1')

  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await ctx.newPage()
  await page.goto(BASE)
  // "탭 강제 종료로 서버에 못 올라간 변경"을 시뮬레이션: 미러=서버+추가카드, 기반버전=서버버전
  await page.evaluate(([mirror, base]) => {
    localStorage.setItem('kanban-workspace-v1', mirror)
    localStorage.setItem('kanban-workspace-base-version', base)
  }, [JSON.stringify(ws), String(current.version)])
  await page.reload()
  await page.waitForSelector('.column')
  await page.waitForTimeout(1500)

  check('재조정: 미전송 카드가 UI에 유지됨', (await page.locator('.card', { hasText: '유실복구 카드' }).count()) === 1)
  const after = await serverDoc()
  check(`재조정: 서버로 밀어올려짐 (v${current.version}→v${after.version})`, after.version > current.version && JSON.stringify(after.workspace).includes('유실복구 카드'))
  await ctx.close()
}

// ========== [4] 409 충돌: stale 저장이 남의 확정 저장을 덮지 않음 ==========
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await ctx.newPage()
  await page.goto(BASE)
  await page.waitForSelector('.column')
  await page.waitForTimeout(1200) // lastVersion = V 확보

  // 외부 클라이언트가 먼저 저장 (V → V+1): 마커 카드 추가
  const current = await serverDoc()
  const ws = JSON.parse(JSON.stringify(current.workspace))
  const boardId = ws.activeBoardId
  const colId = ws.boards[boardId].columnOrder[0]
  ws.boards[boardId].cards['ext-1'] = {
    id: 'ext-1', title: '외부확정 카드', description: '', labelIds: [], assignee: '', dueDate: null, createdAt: '2026-07-17T00:00:00.000Z',
  }
  ws.boards[boardId].columns[colId].cardIds.push('ext-1')
  await fetch(API, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ workspace: ws, baseVersion: current.version }) })

  // 페이지가 폴링으로 그걸 받기 전에(4초 내) 편집 → stale baseVersion으로 PUT → 409 → pull+알림
  await page.locator('.column').nth(1).locator('.add-card-btn').click()
  await page.locator('.card-composer textarea').fill('경합 카드')
  await page.keyboard.press('Enter')
  await page.keyboard.press('Escape')
  await page.waitForTimeout(2000)

  const after = await serverDoc()
  check('외부 확정 저장이 보존됨 (덮이지 않음)', JSON.stringify(after.workspace).includes('외부확정 카드'))
  check('충돌 알림 토스트 표시', (await page.locator('.toast', { hasText: '충돌' }).count()) === 1)
  check('페이지가 서버 상태로 수렴', (await page.locator('.card', { hasText: '외부확정 카드' }).count()) === 1)
  await ctx.close()
}

// ========== [5] 정적 호스팅 404 오판 방지 + [6] 오프라인→서버 승격 ==========
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await ctx.newPage()
  const messages = []
  page.on('console', (m) => messages.push(m.text()))
  let blocked = true
  let putAttempts = 0
  await ctx.route('**/api/**', (route) => {
    if (blocked) {
      if (route.request().method() === 'PUT') putAttempts++
      return route.fulfill({ status: 404, contentType: 'text/html', body: 'Not Found' })
    }
    return route.continue()
  })
  await page.goto(BASE)
  await page.evaluate(() => localStorage.clear())
  await page.reload()
  await page.waitForSelector('.column')
  await page.waitForTimeout(1500)
  check('모든 /api가 404여도 서버 모드로 오판하지 않음', messages.some((m) => m.includes('백엔드 미감지')))
  check('404 환경에서 PUT 시도 없음', putAttempts === 0)

  // 백엔드가 살아나면(차단 해제) 폴링이 승격
  blocked = false
  await page.waitForTimeout(6000)
  check('백엔드 감지 후 서버 모드 승격 (서버 데이터 수신)', (await page.locator('.card', { hasText: '외부확정 카드' }).count()) === 1)
  await ctx.close()
}

await browser.close()
console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`)
process.exit(failures === 0 ? 0 : 1)
