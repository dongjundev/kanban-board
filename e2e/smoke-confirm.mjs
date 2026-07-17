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

// 제목+설명을 blur 없이 입력한 상태에서 곧바로 확인 클릭 → 커밋 + 닫힘
await page.locator('.card', { hasText: '로그인 화면 개선' }).click()
await page.waitForSelector('.modal')
check('확인 버튼 표시', (await page.locator('.modal-footer-actions .btn-primary', { hasText: '확인' }).count()) === 1)
await page.fill('.modal-title', '확인 버튼으로 저장된 제목')
await page.fill('.modal-description', '확인 버튼으로 저장된 설명')
// 설명 textarea에 포커스가 남아있는 채로 확인 클릭
await page.locator('.modal-footer-actions .btn-primary').click()
await page.waitForTimeout(200)
check('확인 클릭 시 모달 닫힘', (await page.locator('.modal').count()) === 0)
check('제목 커밋됨', (await page.locator('.card', { hasText: '확인 버튼으로 저장된 제목' }).count()) === 1)

// 재열어서 설명도 커밋됐는지 확인
await page.locator('.card', { hasText: '확인 버튼으로 저장된 제목' }).click()
await page.waitForSelector('.modal')
check('설명 커밋됨', (await page.inputValue('.modal-description')) === '확인 버튼으로 저장된 설명')
await page.screenshot({ path: new URL('./modal-confirm.png', import.meta.url).pathname })
await page.keyboard.press('Escape')

await browser.close()
console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`)
process.exit(failures === 0 ? 0 : 1)
