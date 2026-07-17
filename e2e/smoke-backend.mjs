import { chromium } from 'playwright'

const BASE = 'http://localhost:5175'
let failures = 0

function check(name, cond) {
  console.log(`${cond ? 'PASS' : 'FAIL'}: ${name}`)
  if (!cond) failures++
}

async function serverVersion() {
  const res = await fetch('http://localhost:8080/api/workspace/version')
  return (await res.json()).version
}

const browser = await chromium.launch()

// ========== [1] 첫 접속: 로컬(시드) → 서버 마이그레이션 ==========
const initialVersion = await serverVersion()
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await ctx.newPage()
  page.on('pageerror', (e) => { console.log(`PAGE ERROR: ${e.message}`); failures++ })
  await page.goto(BASE)
  await page.evaluate(() => localStorage.clear())
  await page.reload()
  await page.waitForSelector('.column')
  await page.waitForTimeout(1200) // 초기 fetch + 마이그레이션 PUT 대기

  if (initialVersion === 0) {
    const v = await serverVersion()
    check(`빈 서버에 로컬 데이터 마이그레이션 (version 0 → ${v})`, v >= 1)
    const remote = await (await fetch('http://localhost:8080/api/workspace')).json()
    check('서버 문서에 시드 보드 존재', JSON.stringify(remote.workspace).includes('팀 칸반 보드'))
  } else {
    console.log(`SKIP: 서버에 기존 데이터(version ${initialVersion}) — 마이그레이션 검사 생략`)
  }

  // ========== [2] 서버가 진실의 원천: localStorage를 지워도 데이터 유지 ==========
  const col1 = page.locator('.column').first()
  await col1.locator('.add-card-btn').click()
  await col1.locator('.card-composer textarea').fill('서버에 저장된 카드')
  await page.keyboard.press('Enter')
  await page.keyboard.press('Escape')
  await page.waitForTimeout(1000) // 디바운스(400ms) + PUT 대기
  const vAfterAdd = await serverVersion()
  check(`카드 추가가 서버에 저장됨 (version=${vAfterAdd})`, vAfterAdd > (initialVersion || 1))

  await page.evaluate(() => localStorage.clear())
  await page.reload()
  await page.waitForSelector('.column')
  await page.waitForTimeout(1200) // 서버 로드 대기
  check('localStorage 삭제 후에도 카드가 서버에서 복원됨', (await page.locator('.card', { hasText: '서버에 저장된 카드' }).count()) === 1)

  // ========== [3] 브라우저 간 동기화 (독립 컨텍스트 = localStorage 공유 없음) ==========
  const ctxB = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const pageB = await ctxB.newPage()
  pageB.on('pageerror', (e) => { console.log(`P-B ERROR: ${e.message}`); failures++ })
  await pageB.goto(BASE)
  await pageB.waitForSelector('.column')
  await pageB.waitForTimeout(1200)
  check('브라우저 B가 서버 데이터를 로드', (await pageB.locator('.card', { hasText: '서버에 저장된 카드' }).count()) === 1)

  // A에서 카드 추가 → B가 폴링(4초)으로 수신
  await col1.locator('.add-card-btn').click()
  await page.locator('.card-composer textarea').fill('브라우저 간 동기화 카드')
  await page.keyboard.press('Enter')
  await page.keyboard.press('Escape')
  await pageB.waitForSelector('.card:has-text("브라우저 간 동기화 카드")', { timeout: 10000 }).catch(() => {})
  check('브라우저 B에 폴링 동기화 반영', (await pageB.locator('.card', { hasText: '브라우저 간 동기화 카드' }).count()) === 1)

  // B에서 편집 → A로 역방향 동기화
  const colB = pageB.locator('.column').first()
  await colB.locator('.add-card-btn').click()
  await pageB.locator('.card-composer textarea').fill('역방향 동기화 카드')
  await pageB.keyboard.press('Enter')
  await pageB.keyboard.press('Escape')
  await page.waitForSelector('.card:has-text("역방향 동기화 카드")', { timeout: 10000 }).catch(() => {})
  check('브라우저 A에 역방향 동기화 반영', (await page.locator('.card', { hasText: '역방향 동기화 카드' }).count()) === 1)

  await ctx.close()
  await ctxB.close()
}

await browser.close()
console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`)
process.exit(failures === 0 ? 0 : 1)
