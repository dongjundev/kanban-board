import { chromium } from 'playwright'

const BASE = 'http://localhost:5175'
const SHOT_DIR = new URL('.', import.meta.url).pathname
let failures = 0

function check(name, cond) {
  console.log(`${cond ? 'PASS' : 'FAIL'}: ${name}`)
  if (!cond) failures++
}

async function dragTo(page, fromLocator, toX, toY) {
  const from = await fromLocator.boundingBox()
  const startX = from.x + from.width / 2
  const startY = from.y + from.height / 2
  await page.mouse.move(startX, startY)
  await page.mouse.down()
  // PointerSensor 활성화(4px) + dragOver가 발생하도록 단계적으로 이동
  const steps = 20
  for (let i = 1; i <= steps; i++) {
    await page.mouse.move(startX + ((toX - startX) * i) / steps, startY + ((toY - startY) * i) / steps)
    await page.waitForTimeout(15)
  }
  await page.waitForTimeout(100)
  await page.mouse.up()
  await page.waitForTimeout(300)
}

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
page.on('console', (msg) => {
  if (msg.type() === 'error') console.log(`CONSOLE ERROR: ${msg.text()}`)
})
page.on('pageerror', (err) => {
  console.log(`PAGE ERROR: ${err.message}`)
  failures++
})

await page.goto(BASE)
await page.evaluate(() => localStorage.clear())
await page.reload()
await page.waitForSelector('.column')

// 1. 시드 데이터 렌더링
check('보드 제목', (await page.textContent('.board-title')) === '팀 칸반 보드')
check('컬럼 3개', (await page.locator('.column').count()) === 3)
check('카드 5개', (await page.locator('.card').count()) === 5)
const colTitles = await page.locator('.column-title').allTextContents()
check('컬럼 순서 할일/진행중/완료', JSON.stringify(colTitles) === JSON.stringify(['할 일', '진행 중', '완료']))
await page.screenshot({ path: `${SHOT_DIR}board-initial.png` })

// 2. 카드 모달: 열기 → 제목 수정 → 담당자 수정 → 닫기
await page.locator('.card', { hasText: '로그인 화면 개선' }).click()
await page.waitForSelector('.modal')
check('모달 열림', await page.locator('.modal').isVisible())
check('모달 컨텍스트=컬럼명', (await page.textContent('.modal-context')) === '할 일')
await page.fill('.modal-title', '로그인 화면 개선 v2')
await page.locator('.modal-description').click() // blur → 커밋
await page.fill('#card-assignee', '최영희')
await page.screenshot({ path: `${SHOT_DIR}modal.png` })
// Esc는 이제 '편집 취소'가 우선이므로 X 버튼으로 닫기 (blur가 담당자 커밋)
await page.locator('.modal-header .btn-icon').click()
await page.waitForTimeout(200)
check('모달 닫힘', (await page.locator('.modal').count()) === 0)
check('카드 제목 수정 반영', (await page.locator('.card', { hasText: '로그인 화면 개선 v2' }).count()) === 1)

// 3. 카드 추가 (composer)
const firstColumn = page.locator('.column').first()
await firstColumn.locator('.add-card-btn').click()
await firstColumn.locator('.card-composer textarea').fill('새로 추가한 카드')
await page.keyboard.press('Enter')
await page.waitForTimeout(200)
check('카드 추가됨', (await firstColumn.locator('.card', { hasText: '새로 추가한 카드' }).count()) === 1)
check('composer 유지(연속입력)', (await firstColumn.locator('.card-composer textarea').count()) === 1)
await page.keyboard.press('Escape')

// 4. 컬럼 추가
await page.locator('.add-column-btn').click()
await page.fill('.column-composer input', '검토 중')
await page.keyboard.press('Enter')
await page.waitForTimeout(200)
check('컬럼 추가됨', (await page.locator('.column').count()) === 4)

// 5. 카드 드래그: '새로 추가한 카드'(할 일)를 '진행 중' 컬럼으로
const dragCard = page.locator('.card', { hasText: '새로 추가한 카드' })
const doingColumn = page.locator('.column', { has: page.locator('.column-title', { hasText: '진행 중' }) })
const doingBox = await doingColumn.boundingBox()
await dragTo(page, dragCard, doingBox.x + doingBox.width / 2, doingBox.y + doingBox.height / 2)
const movedCount = await doingColumn.locator('.card', { hasText: '새로 추가한 카드' }).count()
check('카드가 진행 중 컬럼으로 이동', movedCount === 1)

// 6. 컬럼 드래그: '검토 중' 컬럼 헤더를 맨 앞(할 일 위치)으로
const reviewHeader = page
  .locator('.column', { has: page.locator('.column-title', { hasText: '검토 중' }) })
  .locator('.column-header')
const firstColBox = await page.locator('.column').first().boundingBox()
await dragTo(page, reviewHeader, firstColBox.x + firstColBox.width / 2, firstColBox.y + 20)
const orderAfter = await page.locator('.column-title').allTextContents()
check(`컬럼 순서 변경 (현재: ${orderAfter.join(',')})`, orderAfter[0] === '검토 중')

// 7. 검색 필터
await page.fill('.search-box input', 'API')
await page.waitForTimeout(200)
check('검색 필터: 1장만 표시', (await page.locator('.card').count()) === 1)
check('필터 초기화 버튼 표시', (await page.locator('button', { hasText: '필터 초기화' }).count()) === 1)
await page.locator('button', { hasText: '필터 초기화' }).click()
check('필터 해제 후 6장', (await page.locator('.card').count()) === 6)

// 8. 라벨 필터
await page.locator('.label-filter > button').click()
await page.locator('.label-menu-item', { hasText: '버그' }).click()
await page.keyboard.press('Escape')
await page.locator('.board-title').click({ position: { x: 0, y: 0 }, force: true }) // 팝오버 밖 클릭... 대신 body 클릭
await page.waitForTimeout(200)
const bugCards = await page.locator('.card').count()
check(`라벨 필터: 버그 카드만 (${bugCards}장)`, bugCards === 1)
await page.locator('button', { hasText: '필터 초기화' }).click()

// 9. 새로고침 후 영속성
await page.reload()
await page.waitForSelector('.column')
check('새로고침 후 컬럼 4개 유지', (await page.locator('.column').count()) === 4)
check('새로고침 후 카드 6장 유지', (await page.locator('.card').count()) === 6)
check(
  '새로고침 후 이동한 카드 위치 유지',
  (await page
    .locator('.column', { has: page.locator('.column-title', { hasText: '진행 중' }) })
    .locator('.card', { hasText: '새로 추가한 카드' })
    .count()) === 1,
)

await page.screenshot({ path: `${SHOT_DIR}board-final.png` })
await browser.close()
console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`)
process.exit(failures === 0 ? 0 : 1)
