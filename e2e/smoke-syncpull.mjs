import { chromium } from 'playwright'

// 원격 상태 적용(pull)과 미저장 로컬 변경이 엇갈릴 때의 회귀 — 폴링이 다른 기기의 변경을 적용한
// 직후, 대기 중이던 로컬 스냅샷(원격 변경 이전 상태 기반)이 새 baseVersion을 달고 저장되어 원격
// 변경을 조용히 덮던 버그. 화면은 원격 상태를 보여주는데 서버는 다른 상태라, 버전이 같아진 폴링이
// 다시 받아오지 않아 "실시간 반영이 안 되는" 상태로 남았다. 응답을 게이트로 붙잡아 경합을 결정적으로 만든다.
// 전제: 백엔드 켬(빈 DB 불필요 — 매번 고유 표식 카드로 검증), 프론트 5175.
const BASE = 'http://localhost:5175'
const API = 'http://localhost:8080/api/workspace'
const TAG = Math.random().toString(36).slice(2, 7)
let failures = 0

function check(name, cond, extra = '') {
  console.log(`${cond ? 'PASS' : 'FAIL'}: ${name}${extra ? ` — ${extra}` : ''}`)
  if (!cond) failures++
}

async function serverDoc() {
  return await (await fetch(API)).json()
}

/** 붙잡아 둔 요청을 테스트가 원하는 순간에 놓아주기 위한 게이트 */
function gate() {
  let release
  const opened = new Promise((resolve) => (release = resolve))
  return { opened, release }
}

const isFullGet = (r) => r.method() === 'GET' && new URL(r.url()).pathname === '/api/workspace'

async function activeBoardIdOf(page) {
  return await page.evaluate(() => JSON.parse(localStorage.getItem('kanban-workspace-v1')).activeBoardId)
}

/** 다른 기기가 (화면에 보이는) 보드의 첫 컬럼에 카드를 추가 저장 */
async function externalAddCard(boardId, title) {
  const cur = await serverDoc()
  const board = cur.workspace.boards[boardId]
  const id = `ext-${Math.random().toString(36).slice(2, 8)}`
  board.cards[id] = { id, title, description: '', labelIds: [], assignee: '', dueDate: null, createdAt: new Date().toISOString() }
  board.columns[board.columnOrder[0]].cardIds.push(id)
  const res = await fetch(API, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ workspace: cur.workspace, baseVersion: cur.version }),
  })
  return res.ok
}

async function addLocalCard(page, title) {
  const col = page.locator('.column').nth(1)
  await col.locator('.add-card-btn').click()
  await col.locator('.card-composer textarea').fill(title)
  await page.keyboard.press('Enter')
  await page.keyboard.press('Escape')
}

/** 서버 문서와 화면이 두 표식 카드에 대해 일치하는지 + 원격 변경이 보존됐는지 */
async function checkConverged(label, page, local, remote) {
  const json = JSON.stringify((await serverDoc()).workspace)
  const onScreen = async (t) => (await page.locator('.card', { hasText: t }).count()) === 1
  const state = `서버 L=${json.includes(local)} R=${json.includes(remote)} / 화면 L=${await onScreen(local)} R=${await onScreen(remote)}`
  check(`${label}: 다른 기기의 확정 저장이 덮이지 않음`, json.includes(remote), state)
  check(
    `${label}: 화면이 서버와 일치`,
    json.includes(local) === (await onScreen(local)) && json.includes(remote) === (await onScreen(remote)),
    state,
  )
}

const browser = await chromium.launch()

// ===== [1] 폴링 pull 응답이 로컬 편집 직후(저장 디바운스 대기 중)에 도착 =====
{
  const LOCAL = `로컬1-${TAG}`
  const REMOTE = `원격1-${TAG}`
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await ctx.newPage()
  await page.goto(BASE)
  await page.waitForSelector('.column')
  await page.waitForTimeout(1500) // 초기 동기화 정착

  let hold = null
  await page.route('**/api/workspace', async (route) => {
    if (isFullGet(route.request()) && hold) await hold.opened
    await route.continue()
  })
  hold = gate()
  const pulling = page.waitForRequest(isFullGet, { timeout: 10000 })
  check('[1] 외부 저장 성공', await externalAddCard(await activeBoardIdOf(page), REMOTE))
  await pulling // 폴링이 버전 변화를 감지해 문서를 받으러 감 — 응답은 붙잡혀 있음
  await addLocalCard(page, LOCAL) // 이 편집의 저장은 400ms 디바운스 대기 중
  const g = hold
  hold = null
  g.release() // 디바운스가 끝나기 전에 pull 응답 도착
  await page.waitForTimeout(3000)
  check('[1] 로컬 변경 유실을 충돌 토스트로 알림', (await page.locator('.toast', { hasText: '충돌' }).count()) === 1)
  await checkConverged('[1]', page, LOCAL, REMOTE)
  await page.waitForTimeout(5000) // 폴링 한 바퀴 뒤에도 유지
  await checkConverged('[1] 폴링 후', page, LOCAL, REMOTE)
  await ctx.close()
}

// ===== [2] 저장이 붙잡혔다 실패하는 사이 다른 기기의 변경 도착 → 재시도 =====
{
  const LOCAL = `로컬2-${TAG}`
  const REMOTE = `원격2-${TAG}`
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await ctx.newPage()
  await page.goto(BASE)
  await page.waitForSelector('.column')
  await page.waitForTimeout(1500)

  let holdPut = gate()
  const putHeld = holdPut
  await page.route('**/api/workspace', async (route) => {
    if (route.request().method() === 'PUT' && holdPut) {
      const g = holdPut
      holdPut = null
      await g.opened
      return route.abort() // 네트워크 차단·타임아웃처럼 한참 붙잡혔다가 실패
    }
    await route.continue()
  })
  const putSent = page.waitForRequest((r) => r.method() === 'PUT')
  await addLocalCard(page, LOCAL)
  await putSent
  check('[2] 외부 저장 성공', await externalAddCard(await activeBoardIdOf(page), REMOTE))
  await page.waitForTimeout(5000) // 저장이 붙잡힌 동안 폴링이 최소 한 번 돈다
  putHeld.release()
  await page.waitForTimeout(5000) // 3초 뒤 재시도 + 충돌 처리
  await checkConverged('[2]', page, LOCAL, REMOTE)
  await page.waitForTimeout(5000)
  await checkConverged('[2] 폴링 후', page, LOCAL, REMOTE)
  await ctx.close()
}

// ===== [3] 낡은 미러로 열린 직후, 첫 pull 응답 전에 편집 =====
{
  const LOCAL = `로컬3-${TAG}`
  const REMOTE = `원격3-${TAG}`
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const first = await ctx.newPage()
  await first.goto(BASE)
  await first.waitForSelector('.column')
  await first.waitForTimeout(1500) // 미러 = 현재 서버 문서
  const boardId = await activeBoardIdOf(first)
  await first.close()
  // 이 브라우저가 닫혀 있는 동안 다른 기기가 저장 → 미러가 낡음
  check('[3] 외부 저장 성공', await externalAddCard(boardId, REMOTE))

  const page = await ctx.newPage()
  let hold = gate()
  await page.route('**/api/workspace', async (route) => {
    if (isFullGet(route.request()) && hold) await hold.opened
    await route.continue()
  })
  const firstPull = page.waitForRequest(isFullGet, { timeout: 10000 })
  await page.goto(BASE)
  await page.waitForSelector('.column') // 낡은 미러로 즉시 렌더
  await firstPull
  await addLocalCard(page, LOCAL)
  const g = hold
  hold = null
  g.release()
  await page.waitForTimeout(3000)
  await checkConverged('[3]', page, LOCAL, REMOTE)
  await ctx.close()
}

await browser.close()
console.log(failures === 0 ? '\n모든 검사 통과' : `\n실패 ${failures}건`)
process.exit(failures ? 1 : 0)
