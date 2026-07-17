import { chromium } from 'playwright'

const BASE = 'http://localhost:5175'
let failures = 0

function check(name, cond) {
  console.log(`${cond ? 'PASS' : 'FAIL'}: ${name}`)
  if (!cond) failures++
}

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
page.on('pageerror', (e) => { console.log(`PAGE ERROR: ${e.message}`); failures++ })

await page.goto(BASE)
await page.evaluate(() => localStorage.clear())
await page.reload()
await page.waitForSelector('.column')

// [1] 인앱 확인 다이얼로그: 취소는 no-op, 수량 표시
{
  await page.locator('.card', { hasText: '로그인 화면 개선' }).click()
  await page.waitForSelector('.modal')
  await page.locator('.btn-danger', { hasText: '카드 삭제' }).click()
  check('confirm 다이얼로그 표시', (await page.locator('.confirm-dialog').count()) === 1)
  await page.locator('.confirm-cancel').click()
  await page.waitForTimeout(200)
  check('취소 시 카드 유지 + 모달 유지', (await page.locator('.modal').count()) === 1)
  await page.keyboard.press('Escape')
  await page.waitForTimeout(200)
}

// [2] 검색: 담당자·라벨 이름 매칭
{
  await page.fill('.search-box input', '이수민')
  await page.waitForTimeout(200)
  check('담당자 이름 검색 매칭', (await page.locator('.card').count()) === 2)
  await page.fill('.search-box input', '디자인')
  await page.waitForTimeout(200)
  check('라벨 이름 검색 매칭', (await page.locator('.card').count()) === 1)
}

// [3] 결과 0건 빈 상태 + 필터 초기화
{
  await page.fill('.search-box input', 'zz존재하지않는검색어zz')
  await page.waitForTimeout(200)
  check('0건 빈 상태 표시', (await page.locator('.board-empty-filter').count()) === 1)
  await page.locator('.board-empty-filter button', { hasText: '필터 초기화' }).click()
  await page.waitForTimeout(200)
  check('빈 상태에서 필터 초기화 동작', (await page.locator('.card').count()) === 5)
}

// [4] 보드별 필터 기억 (전환했다 돌아오면 복원)
{
  await page.fill('.search-box input', 'API')
  await page.waitForTimeout(200)
  await page.locator('.board-switcher > button').click()
  await page.fill('.board-create input', '두번째 보드')
  await page.keyboard.press('Enter')
  await page.waitForTimeout(300)
  check('새 보드는 필터 없음', (await page.inputValue('.search-box input')) === '')
  await page.locator('.board-switcher > button').click()
  await page.locator('.board-switcher-name', { hasText: '팀 칸반 보드' }).click()
  await page.waitForTimeout(300)
  check('돌아오면 검색어 복원', (await page.inputValue('.search-box input')) === 'API')
  check('복원된 필터 적용', (await page.locator('.card').count()) === 1)
  await page.locator('button', { hasText: '필터 초기화' }).click()
}

// [5] 보드 순서 변경 (아래로 이동)
{
  await page.locator('.board-switcher > button').click()
  const namesBefore = await page.locator('.board-switcher-name').allTextContents()
  await page.locator('.board-switcher-row').first().hover()
  await page.locator('.board-switcher-row').first().locator('button[title="아래로 이동"]').click()
  await page.waitForTimeout(200)
  const namesAfter = await page.locator('.board-switcher-name').allTextContents()
  check(
    `보드 순서 변경 (${namesBefore.join(',')} → ${namesAfter.join(',')})`,
    namesAfter[0] === namesBefore[1] && namesAfter[1] === namesBefore[0],
  )
  // 원복 + 두번째 보드 삭제
  await page.locator('.board-switcher-row', { has: page.locator('text=두번째 보드') }).hover()
  await page.locator('.board-switcher-row', { has: page.locator('text=두번째 보드') }).locator('button[title="보드 삭제"]').click()
  await page.locator('.confirm-dialog .btn-danger-solid').click()
  await page.waitForTimeout(300)
}

// [6] 라벨 편집 (이름·색 수정)
{
  await page.locator('.card', { hasText: '로그인 화면 개선' }).click()
  await page.waitForSelector('.modal')
  await page.locator('.label-picker .btn-subtle').click()
  await page.locator('.label-popover-row', { hasText: '기능' }).hover()
  await page.locator('.label-popover-row', { hasText: '기능' }).locator('button[title="이름·색 편집"]').click()
  await page.locator('.label-edit input').fill('신규 기능')
  await page.locator('.label-edit .color-swatches .color-swatch').nth(5).click() // 파랑
  await page.locator('.label-edit .btn-primary', { hasText: '저장' }).click()
  await page.waitForTimeout(200)
  check('라벨 이름 수정 반영 (팝오버)', (await page.locator('.label-popover-row', { hasText: '신규 기능' }).count()) === 1)
  check('카드 pill에도 반영', (await page.locator('.label-pills .card-label', { hasText: '신규 기능' }).count()) === 1)
  await page.keyboard.press('Escape') // 팝오버 닫기
  await page.waitForTimeout(100)

  // [7] 마감일 지우기 X 버튼
  check('마감일 지우기 버튼 표시', (await page.locator('button[aria-label="마감일 지우기"]').count()) === 1)
  await page.locator('button[aria-label="마감일 지우기"]').click()
  await page.waitForTimeout(200)
  check('마감일 지워짐', (await page.inputValue('#card-due')) === '')
  check('지우기 버튼 사라짐', (await page.locator('button[aria-label="마감일 지우기"]').count()) === 0)

  // [8] 다른 해 마감일 → 연도 표기
  await page.fill('#card-due', '2025-11-30')
  await page.keyboard.press('Escape')
  await page.waitForTimeout(200)
  check('작년 마감일에 연도 표기', (await page.locator('.due-pill', { hasText: '2025년 11월 30일' }).count()) === 1)
}

// [9] 설명 있는 카드 아이콘
{
  const withDesc = page.locator('.card', { hasText: '로그인 화면 개선' })
  const withoutDesc = page.locator('.card', { hasText: '온보딩 가이드' })
  check('설명 있는 카드에 아이콘', (await withDesc.locator('.card-desc-icon').count()) === 1)
  check('설명 없는 카드엔 아이콘 없음', (await withoutDesc.locator('.card-desc-icon').count()) === 0)
}

// [10] 맨 위에 카드 추가
{
  const firstColumn = page.locator('.column').first()
  await firstColumn.locator('.column-menu > button').click()
  await page.locator('.menu-item', { hasText: '맨 위에 카드 추가' }).click()
  await page.locator('.card-composer textarea').fill('맨 위 카드')
  await page.keyboard.press('Enter')
  await page.keyboard.press('Escape')
  await page.waitForTimeout(200)
  const firstCardTitle = await firstColumn.locator('.card .card-title').first().textContent()
  check(`컬럼 맨 위에 추가됨 (첫 카드: ${firstCardTitle})`, firstCardTitle === '맨 위 카드')
}

// [11] Shift+Enter는 제출하지 않음
{
  const firstColumn = page.locator('.column').first()
  const before = await firstColumn.locator('.card').count()
  await firstColumn.locator('.add-card-btn').click()
  await firstColumn.locator('.card-composer textarea').fill('shift enter 테스트')
  await page.keyboard.press('Shift+Enter')
  await page.waitForTimeout(200)
  check('Shift+Enter로 카드가 생성되지 않음', (await firstColumn.locator('.card').count()) === before)
  check('입력 내용 유지', (await firstColumn.locator('.card-composer textarea').inputValue()) === 'shift enter 테스트')
  await page.keyboard.press('Escape')
}

// [12] 컬럼 composer 연속 입력
{
  await page.locator('.add-column-btn').click()
  await page.locator('.column-composer input').fill('연속 컬럼 1')
  await page.keyboard.press('Enter')
  await page.waitForTimeout(200)
  check('컬럼 추가 후 composer 유지', (await page.locator('.column-composer input').count()) === 1)
  await page.locator('.column-composer input').fill('연속 컬럼 2')
  await page.keyboard.press('Enter')
  await page.keyboard.press('Escape')
  await page.waitForTimeout(200)
  check('연속으로 컬럼 2개 추가', (await page.locator('.column').count()) === 5)
}

// [13] 보드 밖(헤더) 드롭 → 이동 취소, 원위치 복귀
{
  const card = page.locator('.card', { hasText: '맨 위 카드' })
  const box = await card.boundingBox()
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  for (let i = 1; i <= 15; i++) {
    await page.mouse.move(
      box.x + box.width / 2 + ((640 - box.x - box.width / 2) * i) / 15,
      box.y + box.height / 2 + ((25 - box.y - box.height / 2) * i) / 15,
    )
    await page.waitForTimeout(15)
  }
  await page.mouse.up() // 헤더 위에서 드롭
  await page.waitForTimeout(300)
  const stillFirst = await page.locator('.column').first().locator('.card', { hasText: '맨 위 카드' }).count()
  check('보드 밖 드롭 시 카드가 원래 컬럼에 유지', stillFirst === 1)
}

// [14] 담당자 +N 축약 (7명 만들기)
{
  await page.evaluate(() => {
    const raw = localStorage.getItem('kanban-workspace-v1')
    const ws = JSON.parse(raw)
    const board = ws.boards[ws.activeBoardId]
    const names = ['김일번', '이이번', '박삼번', '최사번', '정오번', '한육번', '조칠번']
    names.forEach((name, i) => {
      const id = `extra-${i}`
      board.cards[id] = { id, title: `담당자 테스트 ${i}`, description: '', labelIds: [], assignee: name, dueDate: null, createdAt: '2026-01-01T00:00:00.000Z' }
      board.columns[board.columnOrder[0]].cardIds.push(id)
    })
    localStorage.setItem('kanban-workspace-v1', JSON.stringify(ws))
  })
  await page.reload()
  await page.waitForSelector('.column')
  const avatarButtons = await page.locator('.assignee-toggle:not(.assignee-overflow)').count()
  check(`아바타 5개로 축약 (표시: ${avatarButtons})`, avatarButtons === 5)
  check('+N 버튼 표시', (await page.locator('.assignee-overflow').count()) === 1)
  await page.locator('.assignee-overflow').click()
  const menuRows = await page.locator('.assignee-menu .label-menu-item').count()
  check(`+N 메뉴에 전체 담당자 (${menuRows}명)`, menuRows >= 9)
  await page.locator('.assignee-menu .label-menu-item', { hasText: '조칠번' }).click()
  await page.mouse.click(700, 600)
  await page.waitForTimeout(200)
  check('오버플로 담당자로 필터', (await page.locator('.card').count()) === 1)
}

await browser.close()
console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`)
process.exit(failures === 0 ? 0 : 1)
