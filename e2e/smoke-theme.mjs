import { chromium } from 'playwright'

const BASE = 'http://localhost:5175'
const SHOT_DIR = new URL('.', import.meta.url).pathname
let failures = 0

function check(name, cond) {
  console.log(`${cond ? 'PASS' : 'FAIL'}: ${name}`)
  if (!cond) failures++
}

const browser = await chromium.launch()

// 1. OS 다크 설정 → 저장된 선호 없으면 다크로 시작
{
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, colorScheme: 'dark' })
  await page.goto(BASE)
  await page.evaluate(() => localStorage.clear())
  await page.reload()
  await page.waitForSelector('.column')
  const theme = await page.evaluate(() => document.documentElement.dataset.theme)
  check('OS 다크 → 기본 다크 테마', theme === 'dark')
  const bodyBg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor)
  check(`다크 배경색 적용 (${bodyBg})`, bodyBg === 'rgb(22, 26, 29)') // #161a1d
  await page.close()
}

// 2. OS 라이트 → 라이트 시작, 토글 → 다크 + 저장 + 새로고침 유지
{
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, colorScheme: 'light' })
  page.on('pageerror', (err) => {
    console.log(`PAGE ERROR: ${err.message}`)
    failures++
  })
  await page.goto(BASE)
  await page.evaluate(() => localStorage.clear())
  await page.reload()
  await page.waitForSelector('.column')
  check('OS 라이트 → 기본 라이트 테마', (await page.evaluate(() => document.documentElement.dataset.theme)) === 'light')
  await page.screenshot({ path: `${SHOT_DIR}theme-light.png` })

  await page.locator('.theme-toggle').click()
  await page.waitForTimeout(200)
  check('토글 후 다크 테마', (await page.evaluate(() => document.documentElement.dataset.theme)) === 'dark')
  check(
    '선호가 localStorage에 저장됨',
    (await page.evaluate(() => localStorage.getItem('kanban-board-theme'))) === 'dark',
  )
  await page.screenshot({ path: `${SHOT_DIR}theme-dark.png` })

  await page.reload()
  await page.waitForSelector('.column')
  check('새로고침 후 다크 유지 (OS는 라이트여도)', (await page.evaluate(() => document.documentElement.dataset.theme)) === 'dark')

  // 다크에서 모달/팝오버 확인 스크린샷
  await page.locator('.card', { hasText: '로그인 화면 개선' }).click()
  await page.waitForSelector('.modal')
  await page.locator('.label-picker .btn-subtle').click()
  await page.waitForTimeout(200)
  await page.screenshot({ path: `${SHOT_DIR}theme-dark-modal.png` })
  await page.keyboard.press('Escape')
  await page.keyboard.press('Escape')

  // 다시 라이트로 토글
  await page.locator('.theme-toggle').click()
  check('다시 라이트로 토글', (await page.evaluate(() => document.documentElement.dataset.theme)) === 'light')
  await page.close()
}

await browser.close()
console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`)
process.exit(failures === 0 ? 0 : 1)
