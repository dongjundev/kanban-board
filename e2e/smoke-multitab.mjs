import { chromium } from 'playwright'

const BASE = 'http://localhost:5175'
let failures = 0

function check(name, cond) {
  console.log(`${cond ? 'PASS' : 'FAIL'}: ${name}`)
  if (!cond) failures++
}

async function instrumentWrites(page) {
  await page.evaluate(() => {
    window.__writes = 0
    const original = Storage.prototype.setItem
    Storage.prototype.setItem = function (...args) {
      if (args[0] === 'kanban-workspace-v1') window.__writes++
      return original.apply(this, args)
    }
  })
}

const browser = await chromium.launch()
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })

// 탭1: 초기화 + 두 번째 보드 생성
const page1 = await context.newPage()
page1.on('pageerror', (e) => { console.log(`P1 ERROR: ${e.message}`); failures++ })
await page1.goto(BASE)
await page1.evaluate(() => localStorage.clear())
await page1.reload()
await page1.waitForSelector('.column')
await page1.locator('.board-switcher > button').click()
await page1.fill('.board-create input', '보드2')
await page1.keyboard.press('Enter')
await page1.waitForTimeout(300) // 탭1 활성: 보드2

// 탭2: 열고 '팀 칸반 보드'로 전환 → 두 탭의 activeBoardId가 서로 달라짐
const page2 = await context.newPage()
page2.on('pageerror', (e) => { console.log(`P2 ERROR: ${e.message}`); failures++ })
await page2.goto(BASE)
await page2.waitForSelector('.column')
await page2.locator('.board-switcher > button').click()
await page2.locator('.board-switcher-name', { hasText: '팀 칸반 보드' }).click()
await page2.waitForTimeout(300)
check('탭1=보드2, 탭2=팀 칸반 보드 (활성 분기)', (await page1.textContent('.board-title')) === '보드2' && (await page2.textContent('.board-title')) === '팀 칸반 보드')

// 쓰기 계측 시작 → 탭1에서 편집 1회 → 3초 대기
await instrumentWrites(page1)
await instrumentWrites(page2)
await page1.locator('.column').first().locator('.add-card-btn').click()
await page1.locator('.card-composer textarea').fill('핑퐁 테스트 카드')
await page1.keyboard.press('Enter')
await page1.keyboard.press('Escape')
await page1.waitForTimeout(3000)

const w1 = await page1.evaluate(() => window.__writes)
const w2 = await page2.evaluate(() => window.__writes)
check(`무한 쓰기 루프 없음 (탭1 ${w1}회, 탭2 ${w2}회 저장)`, w1 <= 4 && w2 <= 2)

// 동기화는 여전히 동작: 탭2가 보드2로 전환하면 탭1이 추가한 카드가 보임
await page2.locator('.board-switcher > button').click()
await page2.locator('.board-switcher-name', { hasText: '보드2' }).click()
await page2.waitForTimeout(300)
check('탭 간 데이터 동기화 유지', (await page2.locator('.card', { hasText: '핑퐁 테스트 카드' }).count()) === 1)

// 탭2의 전환이 탭1의 활성 보드를 바꾸지 않음
check('다른 탭 전환에 내 활성 보드 안 끌려감', (await page1.textContent('.board-title')) === '보드2')

// 원격 보드 삭제: 탭2에서 보드2 삭제 → 탭1은 남은 보드로 안전하게 이동
page2.on('dialog', (d) => d.accept())
await page2.locator('.board-switcher > button').click()
await page2.locator('.board-switcher-row', { has: page2.locator('text=보드2') }).hover()
await page2.locator('.board-switcher-row', { has: page2.locator('text=보드2') }).locator('button[title="보드 삭제"]').click()
await page2.locator('.confirm-dialog .btn-danger-solid').click()
await page2.waitForTimeout(500)
check('원격 삭제 시 탭1이 남은 보드로 이동', (await page1.textContent('.board-title')) === '팀 칸반 보드')
check('탭1 크래시 없이 카드 렌더', (await page1.locator('.card').count()) === 5)

await browser.close()
console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`)
process.exit(failures === 0 ? 0 : 1)
