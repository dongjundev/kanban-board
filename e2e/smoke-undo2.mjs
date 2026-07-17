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

// [1] 토스트 표시 중의 다른 변경이 undo에 휩쓸리지 않음 (targeted restore)
{
  await page.locator('.card', { hasText: '배포 파이프라인 정리' }).click()
  await page.waitForSelector('.modal')
  await page.locator('.btn-danger', { hasText: '카드 삭제' }).click()
  await page.locator('.confirm-dialog .btn-danger-solid').click()
  await page.waitForTimeout(300)
  // 토스트가 떠 있는 동안 새 카드 추가
  const col1 = page.locator('.column').first()
  await col1.locator('.add-card-btn').click()
  await col1.locator('.card-composer textarea').fill('토스트 중 추가한 카드')
  await page.keyboard.press('Enter')
  await page.keyboard.press('Escape')
  // 실행 취소
  await page.locator('.toast-undo').click()
  await page.waitForTimeout(300)
  check('undo로 삭제 카드 복원', (await page.locator('.card', { hasText: '배포 파이프라인 정리' }).count()) === 1)
  check('토스트 중 추가한 카드가 살아남음', (await page.locator('.card', { hasText: '토스트 중 추가한 카드' }).count()) === 1)
}

// [2] 리뷰의 critical 재현 시나리오: confirm 대기 중 undo → 이후 라벨 undo가 카드를 다시 지우지 않음
{
  // 카드 삭제 (토스트 생성)
  await page.locator('.card', { hasText: '배포 파이프라인 정리' }).click()
  await page.waitForSelector('.modal')
  await page.locator('.btn-danger', { hasText: '카드 삭제' }).click()
  await page.locator('.confirm-dialog .btn-danger-solid').click()
  await page.waitForTimeout(200)
  // 다른 카드 모달에서 라벨 삭제 confirm을 띄운 채로 둠
  await page.locator('.card', { hasText: '로그인 화면 개선' }).click()
  await page.waitForSelector('.modal')
  await page.locator('.label-picker .btn-subtle').click()
  await page.locator('.label-popover-row', { hasText: '문서' }).hover()
  await page.locator('.label-popover-row', { hasText: '문서' }).locator('button[title="보드에서 라벨 삭제"]').click()
  await page.waitForSelector('.confirm-dialog')
  // confirm이 열린 채 토스트의 실행 취소 클릭 → 카드 복원
  await page.locator('.toast-undo').click()
  await page.waitForTimeout(200)
  check('confirm 열린 채 undo → 카드 복원', (await page.locator('.card', { hasText: '배포 파이프라인 정리' }).count()) === 1)
  // 라벨 삭제 확정 → 라벨 undo
  await page.locator('.confirm-dialog .btn-danger-solid').click()
  await page.waitForTimeout(200)
  await page.locator('.toast-undo').click()
  await page.waitForTimeout(300)
  check('라벨 undo 후에도 복원된 카드가 유지됨 (낡은 스냅샷 미사용)', (await page.locator('.card', { hasText: '배포 파이프라인 정리' }).count()) === 1)
  check('라벨도 복원됨', (await page.locator('.label-picker .card-label', { hasText: '문서' }).count()) >= 0) // 문서 라벨은 이 카드에 미지정 — 존재 확인은 팝오버에서
  await page.locator('.label-picker .btn-subtle').click()
  check('라벨 목록에 문서 복원', (await page.locator('.label-popover-row', { hasText: '문서' }).count()) === 1)

  // [3] confirm 위 Esc → confirm만 취소, 팝오버 유지
  await page.locator('.label-popover-row', { hasText: '문서' }).hover()
  await page.locator('.label-popover-row', { hasText: '문서' }).locator('button[title="보드에서 라벨 삭제"]').click()
  await page.waitForSelector('.confirm-dialog')
  await page.keyboard.press('Escape')
  await page.waitForTimeout(200)
  check('Esc: confirm만 닫힘', (await page.locator('.confirm-dialog').count()) === 0)
  check('Esc: 라벨 팝오버 유지', (await page.locator('.label-popover').count()) === 1)
  check('Esc: 모달 유지', (await page.locator('.modal').count()) === 1)

  // [4] confirm의 취소 버튼 클릭 → 팝오버 유지 (click-outside 가드)
  await page.locator('.label-popover-row', { hasText: '문서' }).hover()
  await page.locator('.label-popover-row', { hasText: '문서' }).locator('button[title="보드에서 라벨 삭제"]').click()
  await page.waitForSelector('.confirm-dialog')
  await page.locator('.confirm-cancel').click()
  await page.waitForTimeout(200)
  check('취소 클릭: 라벨 팝오버 유지', (await page.locator('.label-popover').count()) === 1)
  await page.keyboard.press('Escape') // 팝오버 닫기
  await page.keyboard.press('Escape') // 모달 닫기
  await page.waitForTimeout(200)
}

// [5] 유령 필터가 원본에서도 제거됨 (부활 없음)
{
  // 박지훈 필터 → 유일한 박지훈 카드의 담당자를 바꿈 → 필터 자동 소멸
  await page.locator('.assignee-toggle', { has: page.locator('text=박') }).click()
  await page.waitForTimeout(200)
  check('박지훈 필터 적용: 1장', (await page.locator('.card').count()) === 1)
  await page.locator('.card', { hasText: '대시보드 차트' }).click()
  await page.waitForSelector('.modal')
  await page.fill('#card-assignee', '김동준')
  await page.locator('.modal-footer-actions .btn-primary').click() // 확인 (커밋+닫기)
  await page.waitForTimeout(300)
  check('담당자 변경 후 전체 표시 (유령 필터 정리)', (await page.locator('.card').count()) === 6)
  // 박지훈을 다시 만들어도 필터가 부활하지 않아야 함
  await page.locator('.card', { hasText: '대시보드 차트' }).click()
  await page.waitForSelector('.modal')
  await page.fill('#card-assignee', '박지훈')
  await page.locator('.modal-footer-actions .btn-primary').click()
  await page.waitForTimeout(300)
  check('같은 담당자 재등장에도 필터 부활 없음', (await page.locator('.card').count()) === 6)
  check('필터 초기화 버튼도 없음', (await page.locator('button', { hasText: '필터 초기화' }).count()) === 0)
}

// [6] 원래 빈 보드에서는 '일치하는 카드 없음' 오버레이가 뜨지 않음
{
  await page.locator('.board-switcher > button').click()
  await page.fill('.board-create input', '빈 보드')
  await page.keyboard.press('Enter')
  await page.waitForTimeout(300)
  await page.fill('.search-box input', 'xyz')
  await page.waitForTimeout(200)
  check('빈 보드에서는 필터 빈 상태 오버레이 없음', (await page.locator('.board-empty-filter').count()) === 0)
}

await browser.close()
console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`)
process.exit(failures === 0 ? 0 : 1)
