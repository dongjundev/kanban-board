import { chromium } from 'playwright'

const BASE = 'http://localhost:5175'
let failures = 0

function check(name, cond) {
  console.log(`${cond ? 'PASS' : 'FAIL'}: ${name}`)
  if (!cond) failures++
}

const browser = await chromium.launch()

// ========== 데스크톱: 필터/undo/composer/Esc ==========
{
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  page.on('pageerror', (e) => { console.log(`PAGE ERROR: ${e.message}`); failures++ })
  page.on('dialog', (d) => d.accept())
  await page.goto(BASE)
  await page.evaluate(() => localStorage.clear())
  await page.reload()
  await page.waitForSelector('.column')

  // [1] 필터 중 카드 추가 → 즉시 보임 + 카운트 증가
  await page.fill('.search-box input', 'API')
  await page.waitForTimeout(200)
  check('필터 적용: 1장', (await page.locator('.card').count()) === 1)
  const firstColumn = page.locator('.column').first()
  await firstColumn.locator('.add-card-btn').click()
  await firstColumn.locator('.card-composer textarea').fill('필터중 추가한 카드')
  await page.keyboard.press('Enter')
  await page.waitForTimeout(200)
  check('필터 중 추가한 카드가 즉시 보임', (await page.locator('.card', { hasText: '필터중 추가한 카드' }).count()) === 1)
  const countBadge = await firstColumn.locator('.column-count').textContent()
  check(`컬럼 카운트에 반영 (${countBadge})`, countBadge === '2')
  // 필터를 바꾸면 예외 해제 → 매칭 안 되는 새 카드는 숨겨짐
  await page.fill('.search-box input', 'API 응답')
  await page.waitForTimeout(200)
  check('필터 변경 시 예외 해제되어 숨겨짐', (await page.locator('.card', { hasText: '필터중 추가한 카드' }).count()) === 0)
  await page.locator('button', { hasText: '필터 초기화' }).click()
  await page.keyboard.press('Escape')

  // [2] 카드 삭제 → 토스트 → 실행 취소 → 복원
  await page.locator('.card', { hasText: '로그인 화면 개선' }).click()
  await page.waitForSelector('.modal')
  await page.locator('.btn-danger', { hasText: '카드 삭제' }).click()
  await page.locator('.confirm-dialog .btn-danger-solid').click()
  await page.waitForTimeout(300)
  check('삭제 후 카드 사라짐', (await page.locator('.card', { hasText: '로그인 화면 개선' }).count()) === 0)
  check('삭제 토스트 표시', (await page.locator('.toast', { hasText: '카드를 삭제했습니다' }).count()) === 1)
  await page.locator('.toast-undo').click()
  await page.waitForTimeout(300)
  check('실행 취소로 카드 복원', (await page.locator('.card', { hasText: '로그인 화면 개선' }).count()) === 1)
  check('실행 취소 후 토스트 닫힘', (await page.locator('.toast').count()) === 0)

  // [2b] 활성 보드 삭제 → 실행 취소 → 그 보드로 복귀
  await page.locator('.board-switcher > button').click()
  await page.fill('.board-create input', '임시 보드')
  await page.keyboard.press('Enter')
  await page.waitForTimeout(300) // 활성: 임시 보드
  await page.locator('.board-switcher > button').click()
  await page.locator('.board-switcher-row', { has: page.locator('text=임시 보드') }).hover()
  await page.locator('.board-switcher-row', { has: page.locator('text=임시 보드') }).locator('button[title="보드 삭제"]').click()
  await page.locator('.confirm-dialog .btn-danger-solid').click()
  await page.waitForTimeout(300)
  check('활성 보드 삭제 후 다른 보드로 이동', (await page.textContent('.board-title')) === '팀 칸반 보드')
  check('보드 삭제 토스트', (await page.locator('.toast', { hasText: '보드를 삭제했습니다' }).count()) === 1)
  await page.locator('.toast-undo').click()
  await page.waitForTimeout(300)
  check('실행 취소 시 삭제했던 보드로 복귀', (await page.textContent('.board-title')) === '임시 보드')
  // 정리: 임시 보드 다시 삭제
  await page.locator('.board-switcher > button').click()
  await page.locator('.board-switcher-row', { has: page.locator('text=임시 보드') }).hover()
  await page.locator('.board-switcher-row', { has: page.locator('text=임시 보드') }).locator('button[title="보드 삭제"]').click()
  await page.locator('.confirm-dialog .btn-danger-solid').click()
  await page.waitForTimeout(300)

  // [3] composer 바깥 클릭 → draft 저장 + 닫힘, 동시 열림 방지
  const col1 = page.locator('.column').nth(0)
  const col2 = page.locator('.column').nth(1)
  await col1.locator('.add-card-btn').click()
  await col1.locator('.card-composer textarea').fill('바깥클릭 저장 카드')
  await page.mouse.click(720, 700) // 보드 빈 공간 클릭
  await page.waitForTimeout(200)
  check('바깥 클릭 시 composer 닫힘', (await page.locator('.card-composer').count()) === 0)
  check('바깥 클릭 시 draft가 카드로 저장', (await col1.locator('.card', { hasText: '바깥클릭 저장 카드' }).count()) === 1)
  await col1.locator('.add-card-btn').click()
  await col2.locator('.add-card-btn').click()
  await page.waitForTimeout(200)
  check('composer는 한 번에 하나만 열림', (await page.locator('.card-composer').count()) === 1)
  check('빈 입력 시 추가 버튼 비활성', (await page.locator('.card-composer .btn-primary').isDisabled()) === true)
  await page.keyboard.press('Escape')

  // [4] 라벨 팝오버 Esc 레이어링 (포커스가 토글 버튼에 있는 상태)
  await page.locator('.card', { hasText: '로그인 화면 개선' }).click()
  await page.waitForSelector('.modal')
  await page.locator('.label-picker .btn-subtle').click() // 팝오버 열기 — 포커스는 버튼에
  await page.waitForTimeout(200)
  check('라벨 팝오버 열림', (await page.locator('.label-popover').count()) === 1)
  await page.keyboard.press('Escape')
  await page.waitForTimeout(200)
  check('Esc: 팝오버만 닫힘', (await page.locator('.label-popover').count()) === 0)
  check('Esc: 모달은 유지', (await page.locator('.modal').count()) === 1)
  await page.keyboard.press('Escape')
  await page.waitForTimeout(200)
  check('두 번째 Esc로 모달 닫힘', (await page.locator('.modal').count()) === 0)

  await page.close()
}

// ========== 터치: 스와이프=스크롤, 길게누르기=드래그 ==========
{
  const context = await browser.newContext({ viewport: { width: 420, height: 800 }, hasTouch: true })
  const page = await context.newPage()
  page.on('pageerror', (e) => { console.log(`PAGE ERROR: ${e.message}`); failures++ })
  await page.goto(BASE)
  await page.evaluate(() => localStorage.clear())
  await page.reload()
  await page.waitForSelector('.column')

  const cdp = await context.newCDPSession(page)
  async function swipe(x1, y1, x2, y2, steps, stepDelay, pressDelay = 0) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x1, y: y1 }] })
    if (pressDelay) await page.waitForTimeout(pressDelay)
    for (let i = 1; i <= steps; i++) {
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [{ x: x1 + ((x2 - x1) * i) / steps, y: y1 + ((y2 - y1) * i) / steps }],
      })
      await page.waitForTimeout(stepDelay)
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    await page.waitForTimeout(300)
  }

  // 빠른 가로 스와이프 (카드 위에서 시작) → 보드 가로 스크롤
  const card = page.locator('.card', { hasText: '로그인 화면 개선' })
  const box = await card.boundingBox()
  const cx = box.x + box.width / 2
  const cy = box.y + box.height / 2
  await swipe(cx, cy, cx - 200, cy, 8, 10) // ~80ms — 250ms 딜레이 전에 이동
  const scrollLeft = await page.evaluate(() => document.querySelector('.board').scrollLeft)
  check(`카드 위 빠른 스와이프 → 보드 스크롤 (scrollLeft=${scrollLeft})`, scrollLeft > 0)
  check('빠른 스와이프로 카드가 이동하지 않음', (await page.locator('.column').first().locator('.card', { hasText: '로그인 화면 개선' }).count()) === 1)

  // 원위치로 스크롤 복귀
  await page.evaluate(() => { document.querySelector('.board').scrollLeft = 0 })
  await page.waitForTimeout(200)

  // 길게 누른 뒤 이동 → 카드 드래그 (두 번째 컬럼으로)
  // 420px 뷰포트에서 두 번째 컬럼 중심은 화면 밖이므로, 화면 안에 보이는 부분을 목표로 삼는다
  const box2 = await card.boundingBox()
  const col2Box = await page.locator('.column').nth(1).boundingBox()
  const targetX = Math.min(col2Box.x + 60, 410)
  await swipe(
    box2.x + box2.width / 2,
    box2.y + box2.height / 2,
    targetX,
    col2Box.y + 150,
    15,
    30,
    400, // 길게 누르기 400ms > 250ms 딜레이
  )
  check(
    '길게 누른 뒤 이동 → 카드가 두 번째 컬럼으로 드래그됨',
    (await page.locator('.column').nth(1).locator('.card', { hasText: '로그인 화면 개선' }).count()) === 1,
  )

  await context.close()
}

await browser.close()
console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`)
process.exit(failures === 0 ? 0 : 1)
