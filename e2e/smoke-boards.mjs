import { chromium } from 'playwright'

const BASE = 'http://localhost:5175'
const SHOT_DIR = new URL('.', import.meta.url).pathname
let failures = 0

function check(name, cond) {
  console.log(`${cond ? 'PASS' : 'FAIL'}: ${name}`)
  if (!cond) failures++
}

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
page.on('pageerror', (err) => {
  console.log(`PAGE ERROR: ${err.message}`)
  failures++
})
page.on('dialog', (d) => d.accept())

await page.goto(BASE)
await page.evaluate(() => localStorage.clear())
await page.reload()
await page.waitForSelector('.column')

// 1. 초기: 보드 1개, 삭제 버튼 없음
await page.locator('.board-switcher > button').click()
check('스위처에 보드 1개', (await page.locator('.board-switcher-row').count()) === 1)
check('보드 1개일 땐 삭제 버튼 없음', (await page.locator('.board-switcher-row .btn-icon').count()) === 0)

// 2. 새 보드 생성 → 자동 전환
await page.fill('.board-create input', '개인 프로젝트')
await page.keyboard.press('Enter')
await page.waitForTimeout(300)
check('새 보드로 전환됨 (제목)', (await page.textContent('.board-title')) === '개인 프로젝트')
check('새 보드 기본 3컬럼', (await page.locator('.column').count()) === 3)
check('새 보드는 카드 0장', (await page.locator('.card').count()) === 0)

// 3. 새 보드에 카드 추가
await page.locator('.column').first().locator('.add-card-btn').click()
await page.locator('.card-composer textarea').fill('사이드 프로젝트 계획')
await page.keyboard.press('Enter')
await page.keyboard.press('Escape')
check('새 보드에 카드 추가', (await page.locator('.card').count()) === 1)

// 4. 원래 보드로 전환 → 데이터 온전
await page.locator('.board-switcher > button').click()
await page.locator('.board-switcher-name', { hasText: '팀 칸반 보드' }).click()
await page.waitForTimeout(300)
check('원래 보드로 전환', (await page.textContent('.board-title')) === '팀 칸반 보드')
check('원래 보드 카드 5장 유지', (await page.locator('.card').count()) === 5)

// 5. 필터 걸고 전환하면 필터 초기화
await page.fill('.search-box input', 'API')
await page.waitForTimeout(200)
check('필터 적용됨', (await page.locator('.card').count()) === 1)
await page.locator('.board-switcher > button').click()
await page.locator('.board-switcher-name', { hasText: '개인 프로젝트' }).click()
await page.waitForTimeout(300)
check('보드 전환 시 필터 초기화 (검색어 비움)', (await page.inputValue('.search-box input')) === '')
check('전환된 보드 카드 표시', (await page.locator('.card').count()) === 1)

// 6. 새로고침 → 활성 보드/데이터 유지
await page.reload()
await page.waitForSelector('.column')
check('새로고침 후 활성 보드 유지', (await page.textContent('.board-title')) === '개인 프로젝트')
await page.locator('.board-switcher > button').click()
check('새로고침 후 보드 2개 유지', (await page.locator('.board-switcher-row').count()) === 2)
await page.keyboard.press('Escape')

// 7. 보드 이름 변경 → 스위처에 반영
await page.locator('.board-title').click()
await page.fill('.board-title-input', '사이드 프로젝트')
await page.keyboard.press('Enter')
await page.waitForTimeout(200)
await page.locator('.board-switcher > button').click()
check(
  '이름 변경이 스위처에 반영',
  (await page.locator('.board-switcher-name', { hasText: '사이드 프로젝트' }).count()) === 1,
)
await page.screenshot({ path: `${SHOT_DIR}board-switcher.png` })

// 8. 보드 삭제 → 남은 보드로 이동
await page.locator('.board-switcher-row', { has: page.locator('text=사이드 프로젝트') }).hover()
await page.locator('.board-switcher-row', { has: page.locator('text=사이드 프로젝트') }).locator('button[title="보드 삭제"]').click()
await page.locator('.confirm-dialog .btn-danger-solid').click()
await page.waitForTimeout(300)
check('보드 삭제 후 남은 보드로 이동', (await page.textContent('.board-title')) === '팀 칸반 보드')
check('삭제 후 카드 5장', (await page.locator('.card').count()) === 5)

// 9. 레거시 단일 보드 마이그레이션
await page.waitForTimeout(600) // 직전 삭제의 trailing 미러 플러시(400ms)가 정착한 뒤 clear
await page.evaluate(() => {
  localStorage.clear()
  localStorage.setItem(
    'kanban-board-state-v1',
    JSON.stringify({
      boardTitle: '레거시 보드',
      columns: { c: { id: 'c', title: '할 일', cardIds: ['k'] } },
      columnOrder: ['c'],
      cards: {
        k: { id: 'k', title: '옛 카드', description: '', labelIds: [], assignee: '', dueDate: null, createdAt: '2026-01-01T00:00:00.000Z' },
      },
      labels: {},
    }),
  )
})
await page.reload()
await page.waitForSelector('.column')
check('레거시 보드가 마이그레이션됨', (await page.textContent('.board-title')) === '레거시 보드')
check('레거시 카드 유지', (await page.locator('.card', { hasText: '옛 카드' }).count()) === 1)
const wsSaved = await page.evaluate(() => localStorage.getItem('kanban-workspace-v1') !== null)
check('워크스페이스 키로 저장됨', wsSaved)

await browser.close()
console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`)
process.exit(failures === 0 ? 0 : 1)
