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

await page.goto(BASE)
await page.evaluate(() => localStorage.clear())
await page.reload()
await page.waitForSelector('.column')

// [fix 2] 드래그 중 Esc 취소 → 컬럼 간 이동 롤백
{
  const card = page.locator('.card', { hasText: '로그인 화면 개선' })
  const box = await card.boundingBox()
  const target = await page.locator('.column').nth(1).boundingBox()
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  for (let i = 1; i <= 15; i++) {
    await page.mouse.move(
      box.x + box.width / 2 + ((target.x + target.width / 2 - box.x - box.width / 2) * i) / 15,
      box.y + box.height / 2 + ((target.y + target.height / 2 - box.y - box.height / 2) * i) / 15,
    )
    await page.waitForTimeout(15)
  }
  await page.waitForTimeout(100)
  await page.keyboard.press('Escape') // 드래그 취소
  await page.waitForTimeout(200)
  await page.mouse.up()
  await page.waitForTimeout(200)
  const backInFirst = await page.locator('.column').first().locator('.card', { hasText: '로그인 화면 개선' }).count()
  check('Esc 드래그 취소 시 카드가 원래 컬럼으로 롤백', backInFirst === 1)
}

// [fix 1] 키보드로 카드 모달 열기: 카드 포커스 → Enter
{
  await page.locator('.card', { hasText: '로그인 화면 개선' }).focus()
  await page.keyboard.press('Enter')
  await page.waitForTimeout(200)
  check('카드에서 Enter로 모달 열림', (await page.locator('.modal').count()) === 1)
  // [fix 12] 포커스가 모달 내부로 이동했는지
  const focusInModal = await page.evaluate(() => document.querySelector('.modal')?.contains(document.activeElement))
  check('모달 열림 시 포커스가 모달 내부로 이동', focusInModal === true)
  await page.keyboard.press('Escape')
  await page.waitForTimeout(200)
  check('Esc로 모달 닫힘', (await page.locator('.modal').count()) === 0)
  // 포커스 복원
  const focusRestored = await page.evaluate(() => document.activeElement?.classList.contains('card'))
  check('모달 닫힘 후 카드로 포커스 복원', focusRestored === true)
}

// [fix 5] 백드롭 클릭으로 닫아도 제목 draft 커밋
{
  await page.locator('.card', { hasText: '로그인 화면 개선' }).click()
  await page.waitForSelector('.modal')
  await page.fill('.modal-title', '백드롭 커밋 테스트')
  await page.mouse.click(100, 500) // 백드롭 클릭
  await page.waitForTimeout(300)
  check('백드롭 클릭 시 모달 닫힘', (await page.locator('.modal').count()) === 0)
  check('백드롭 클릭 시 제목 draft 커밋됨', (await page.locator('.card', { hasText: '백드롭 커밋 테스트' }).count()) === 1)
}

// [fix 7] 모달에서 제목 편집 중 Esc → 편집만 취소, 모달 유지
{
  await page.locator('.card', { hasText: '백드롭 커밋 테스트' }).click()
  await page.waitForSelector('.modal')
  await page.locator('.modal-title').click()
  await page.fill('.modal-title', '취소되어야 할 제목')
  await page.keyboard.press('Escape')
  await page.waitForTimeout(200)
  check('제목 편집 중 Esc: 모달은 열린 채 유지', (await page.locator('.modal').count()) === 1)
  check('제목 편집 중 Esc: draft 원복', (await page.inputValue('.modal-title')) === '백드롭 커밋 테스트')
  await page.keyboard.press('Escape')
  await page.waitForTimeout(200)
  check('두 번째 Esc로 모달 닫힘', (await page.locator('.modal').count()) === 0)
  check('취소된 제목이 저장되지 않음', (await page.locator('.card', { hasText: '취소되어야 할 제목' }).count()) === 0)
}

// [fix 4] 컬럼 이름 편집에서 스페이스 입력 가능
{
  await page.locator('.column-title', { hasText: '할 일' }).click()
  await page.waitForSelector('.column-title-input')
  await page.locator('.column-title-input').fill('')
  await page.keyboard.type('백로그 목록', { delay: 30 }) // 공백 포함 타이핑
  await page.keyboard.press('Enter')
  await page.waitForTimeout(200)
  check('컬럼 이름에 공백 입력 가능', (await page.locator('.column-title', { hasText: '백로그 목록' }).count()) === 1)
  // 원복
  await page.locator('.column-title', { hasText: '백로그 목록' }).click()
  await page.locator('.column-title-input').fill('할 일')
  await page.keyboard.press('Enter')
}

// [fix 10] 두 컬럼 메뉴가 동시에 열리지 않음
{
  await page.locator('.column').nth(0).locator('.column-menu > button').click()
  await page.waitForTimeout(100)
  await page.locator('.column').nth(1).locator('.column-menu > button').click()
  await page.waitForTimeout(100)
  check('컬럼 메뉴 팝오버는 항상 1개만 열림', (await page.locator('.menu-popover').count()) === 1)
  await page.mouse.click(700, 700)
}

// [fix 20] 담당자 뒤 공백이 trim되어 유령 아바타 없음
{
  await page.locator('.card', { hasText: 'API 응답 지연' }).click()
  await page.waitForSelector('.modal')
  await page.fill('#card-assignee', '이수민 ') // 뒤 공백
  await page.locator('.modal-description').click() // blur 커밋
  await page.keyboard.press('Escape')
  await page.waitForTimeout(200)
  const avatarCount = await page.locator('.assignee-toggle').count()
  check(`담당자 trim: 아바타 중복 없음 (${avatarCount}개)`, avatarCount === 3)
}

// [fix 3/19] 손상된 localStorage → 시드로 폴백 (크래시 루프 없음)
{
  await page.evaluate(() => {
    localStorage.setItem(
      'kanban-board-state-v1',
      JSON.stringify({ boardTitle: 'x', columns: { a: {} }, columnOrder: ['a'], cards: {}, labels: {} }),
    )
  })
  await page.reload()
  await page.waitForSelector('.column', { timeout: 5000 })
  check('손상 데이터 로드 시 시드 폴백 (흰 화면 없음)', (await page.locator('.column').count()) === 3)
}

// [fix 11/18] 필터에 선택된 라벨 삭제 → 유령 필터 없이 카드 표시 유지
{
  await page.evaluate(() => localStorage.clear())
  await page.reload()
  await page.waitForSelector('.column')
  await page.locator('.label-filter > button').click()
  await page.locator('.label-menu-item', { hasText: '문서' }).click()
  await page.mouse.click(700, 700) // 메뉴 닫기
  await page.waitForTimeout(200)
  check('라벨 필터 적용: 1장', (await page.locator('.card').count()) === 1)
  // 해당 라벨을 보드에서 삭제
  await page.locator('.card', { hasText: '온보딩 가이드' }).click()
  await page.waitForSelector('.modal')
  await page.locator('.label-picker .btn-subtle').click() // 라벨 팝오버 열기
  await page.locator('.label-popover-row', { hasText: '문서' }).hover()
  await page.locator('.label-popover-row', { hasText: '문서' }).locator('button[title="보드에서 라벨 삭제"]').click()
  await page.locator('.confirm-dialog .btn-danger-solid').click() // 인앱 확인 다이얼로그
  await page.waitForTimeout(200)
  await page.keyboard.press('Escape') // 팝오버 닫기
  await page.keyboard.press('Escape') // 모달 닫기
  await page.waitForTimeout(300)
  check('라벨 삭제 후 유령 필터 없이 전체 카드 표시', (await page.locator('.card').count()) === 5)
}

await page.screenshot({ path: `${SHOT_DIR}board-after-fixes.png` })
await browser.close()
console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`)
process.exit(failures === 0 ? 0 : 1)
