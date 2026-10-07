import { chromium } from 'playwright'

// 동기화 체감 회귀 — [1·2] 저장 실패·서버 무응답을 화면에 알리는지(콘솔에만 남기면 동기화되는 줄 안다),
// [3] 열어둔 카드 모달이 다른 기기의 변경을 반영하고 손대지 않은 칸이 그 변경을 되돌리지 않는지,
// [4] 보드 전환(기기별 화면 상태)이 서버 저장·버전 증가를 일으키지 않는지.
// 전제: 백엔드 켬(빈 DB 불필요 — 고유 표식으로 검증, 만든 보드는 스스로 지움), 프론트 5175.
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

async function putDoc(workspace, baseVersion) {
  const res = await fetch(API, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ workspace, baseVersion }),
  })
  return res.ok
}

async function activeBoardIdOf(page) {
  return await page.evaluate(() => JSON.parse(localStorage.getItem('kanban-workspace-v1')).activeBoardId)
}

/** 다른 기기가 (화면에 보이는) 보드의 첫 컬럼에 카드를 추가 저장 — 카드 id 반환 */
async function externalAddCard(boardId, title) {
  const cur = await serverDoc()
  const board = cur.workspace.boards[boardId]
  const id = `ext-${Math.random().toString(36).slice(2, 8)}`
  board.cards[id] = { id, title, description: '', labelIds: [], assignee: '', dueDate: null, createdAt: new Date().toISOString() }
  board.columns[board.columnOrder[0]].cardIds.push(id)
  await putDoc(cur.workspace, cur.version)
  return id
}

/** 다른 기기가 카드 필드를 수정 저장 */
async function externalUpdateCard(boardId, cardId, patch) {
  const cur = await serverDoc()
  Object.assign(cur.workspace.boards[boardId].cards[cardId], patch)
  return await putDoc(cur.workspace, cur.version)
}

async function serverCard(boardId, cardId) {
  return (await serverDoc()).workspace.boards[boardId].cards[cardId]
}

async function openSettled(ctx) {
  const page = await ctx.newPage()
  await page.goto(BASE)
  await page.waitForSelector('.column')
  await page.waitForTimeout(1500) // 초기 동기화 정착
  return page
}

const browser = await chromium.launch()

// ===== [1] 저장이 실패하면 배너, 재시도로 복구되면 사라짐 =====
{
  const LOCAL = `배너-${TAG}`
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await openSettled(ctx)
  let blockPut = true
  await page.route('**/api/workspace', (route) =>
    route.request().method() === 'PUT' && blockPut ? route.abort() : route.continue(),
  )
  const col = page.locator('.column').nth(1)
  await col.locator('.add-card-btn').click()
  await col.locator('.card-composer textarea').fill(LOCAL)
  await page.keyboard.press('Enter')
  await page.keyboard.press('Escape')
  await page.waitForSelector('.sync-banner', { timeout: 3000 }).catch(() => {})
  check('[1] 저장 실패 시 동기화 실패 배너 표시', (await page.locator('.sync-banner').count()) === 1)
  check('[1] 로컬 변경은 화면에 유지', (await page.locator('.card', { hasText: LOCAL }).count()) === 1)
  blockPut = false
  let saved = false
  for (let i = 0; i < 12 && !saved; i++) {
    await page.waitForTimeout(500) // 재시도(3초 주기)가 성공할 때까지
    saved = JSON.stringify((await serverDoc()).workspace).includes(LOCAL)
  }
  check('[1] 재시도로 서버에 저장됨', saved)
  await page.waitForSelector('.sync-banner', { state: 'detached', timeout: 2000 }).catch(() => {})
  check('[1] 복구되면 배너가 사라짐', (await page.locator('.sync-banner').count()) === 0)
  await ctx.close()
}

// ===== [2] 서버 무응답이 이어지면 배너(한 번의 일시 오류로는 안 뜸), 돌아오면 사라짐 =====
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await openSettled(ctx)
  let blockAll = false
  await page.route('**/api/**', (route) => (blockAll ? route.abort() : route.continue()))
  blockAll = true
  await page.waitForTimeout(3000) // 폴링(4초 주기)은 많아야 한 번 실패
  check('[2] 일시 오류 한 번으로는 배너가 뜨지 않음', (await page.locator('.sync-banner').count()) === 0)
  await page.waitForSelector('.sync-banner', { timeout: 10000 }).catch(() => {})
  check('[2] 서버 무응답이 이어지면 배너 표시', (await page.locator('.sync-banner').count()) === 1)
  blockAll = false
  await page.waitForSelector('.sync-banner', { state: 'detached', timeout: 6000 }).catch(() => {})
  check('[2] 서버가 돌아오면 배너가 사라짐', (await page.locator('.sync-banner').count()) === 0)
  await ctx.close()
}

// ===== [3] 열어둔 카드 모달 — 원격 변경 반영, 손대지 않은 칸은 되돌리지 않음, 입력 중인 칸은 덮지 않음 =====
{
  const TITLE = `모달-${TAG}`
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await openSettled(ctx)
  const boardId = await activeBoardIdOf(page)
  const cardId = await externalAddCard(boardId, TITLE)
  await page.locator('.card', { hasText: TITLE }).waitFor({ timeout: 10000 })
  await page.locator('.card', { hasText: TITLE }).click()
  await page.waitForSelector('.modal')

  // 모달을 열어둔 채 다른 기기가 제목·설명·담당자를 바꿈 → 폴링으로 모달 칸에 반영
  await externalUpdateCard(boardId, cardId, { title: `${TITLE}-원격`, description: '원격 설명', assignee: '원격담당' })
  await page
    .waitForFunction((t) => document.querySelector('.modal-title')?.value === t, `${TITLE}-원격`, { timeout: 10000 })
    .catch(() => {})
  check('[3] 열린 모달의 제목에 원격 변경 반영', (await page.inputValue('.modal-title')) === `${TITLE}-원격`)
  check('[3] 설명에도 반영', (await page.inputValue('.modal-description')) === '원격 설명')
  check('[3] 담당자에도 반영', (await page.inputValue('#card-assignee')) === '원격담당')

  // 제목 칸에 포커스만 둔 사이 원격이 제목을 또 바꿈 → 블러해도 되돌리지 않음
  await page.locator('.modal-title').focus()
  await externalUpdateCard(boardId, cardId, { title: `${TITLE}-원격2` })
  await page.waitForTimeout(5500) // 폴링 반영 — 포커스 중인 칸은 그대로 둔다
  check('[3] 포커스 중인 칸은 원격 변경으로 덮지 않음', (await page.inputValue('.modal-title')) === `${TITLE}-원격`)
  await page.locator('.modal-description').focus() // 손대지 않은 제목 칸 블러
  await page.waitForTimeout(1500) // 잘못된 커밋이 있었다면 400ms 디바운스 후 저장됐을 시간
  check(
    '[3] 손대지 않은 칸의 블러가 원격 변경을 되돌리지 않음',
    (await serverCard(boardId, cardId)).title === `${TITLE}-원격2`,
    (await serverCard(boardId, cardId)).title,
  )
  check('[3] 블러 후 제목 칸이 최신 값으로 맞춰짐', (await page.inputValue('.modal-title')) === `${TITLE}-원격2`)

  // 설명을 입력하는 사이 원격이 설명을 바꿈 → 입력은 유지되고, 커밋하면 사용자 값이 저장
  await page.locator('.modal-description').fill('내가 쓴 설명')
  await externalUpdateCard(boardId, cardId, { description: '원격 설명2' })
  await page.waitForTimeout(5500)
  check('[3] 입력 중인 설명이 원격 변경에 덮이지 않음', (await page.inputValue('.modal-description')) === '내가 쓴 설명')
  await page.getByRole('button', { name: '확인' }).click()
  await page.waitForTimeout(1500)
  check('[3] 커밋한 사용자 입력이 저장됨', (await serverCard(boardId, cardId)).description === '내가 쓴 설명')
  await ctx.close()
}

// ===== [4] 보드 전환은 서버에 저장하지 않는다 (새로고침 재조정도 포함) =====
{
  const OTHER = `전환-${TAG}`
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await openSettled(ctx)
  const original = await page.textContent('.board-title')
  await page.locator('.board-switcher > button').click()
  await page.fill('.board-create input', OTHER)
  await page.keyboard.press('Enter')
  await page.waitForTimeout(1500)
  check('[4] 보드 생성(내용 변경)은 서버에 저장', JSON.stringify((await serverDoc()).workspace).includes(OTHER))

  const v0 = (await serverDoc()).version
  let puts = 0
  page.on('request', (r) => {
    if (r.method() === 'PUT' && r.url().includes('/api/workspace')) puts++
  })
  await page.locator('.board-switcher > button').click()
  await page.locator('.board-switcher-name', { hasText: original }).click()
  await page.waitForTimeout(1500)
  check('[4] 보드 전환은 화면에 반영', (await page.textContent('.board-title')) === original)
  check('[4] 보드 전환 시 PUT 없음', puts === 0, `${puts}회`)
  check('[4] 서버 버전 그대로', (await serverDoc()).version === v0)

  await page.reload()
  await page.waitForSelector('.column')
  await page.waitForTimeout(1500)
  check('[4] 새로고침 후에도 전환한 보드 유지', (await page.textContent('.board-title')) === original)
  check('[4] 새로고침 재조정이 선택 차이로 저장하지 않음', puts === 0 && (await serverDoc()).version === v0, `${puts}회`)
  await ctx.close()

  // 정리: 만든 보드를 서버에서 지운다
  const cur = await serverDoc()
  const ws = cur.workspace
  const id = Object.keys(ws.boards).find((k) => ws.boards[k].boardTitle === OTHER)
  if (id) {
    delete ws.boards[id]
    ws.boardOrder = ws.boardOrder.filter((b) => b !== id)
    if (ws.activeBoardId === id) ws.activeBoardId = ws.boardOrder[0]
    await putDoc(ws, cur.version)
  }
}

await browser.close()
console.log(failures === 0 ? '\n모든 검사 통과' : `\n실패 ${failures}건`)
process.exit(failures ? 1 : 0)
