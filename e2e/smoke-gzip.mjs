import { chromium } from 'playwright'

// gzip 요청 본문 회귀 — 메모·차트 저장 본문이 Content-Encoding: gzip으로 압축돼 나가고,
// 서버(GzipRequestFilter)가 풀어서 온전히 저장하는지. 회사망 보안장비가 큰 요청 본문을
// 막아 긴 메모·차트 저장이 실패하던 문제의 대응이라, 압축이 실제로 적용됐는지(전송 크기)까지 본다.
// 전제: 백엔드 켬(빈 DB 불필요 — 만든 메모·차트는 끝에 API로 지운다), 프론트 5175.
const BASE = 'http://localhost:5175'
let failures = 0

function check(name, cond, extra = '') {
  console.log(`${cond ? 'PASS' : 'FAIL'}: ${name}${extra ? ` — ${extra}` : ''}`)
  if (!cond) failures++
}

const TAG = Math.random().toString(36).slice(2, 7)

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } })
page.on('pageerror', (e) => {
  console.log(`PAGE ERROR: ${e.message}`)
  failures++
})

// 저장 요청(POST/PUT)을 기록해 두고 나중에 헤더·전송 크기를 검사한다
const saves = []
page.on('request', (r) => {
  const u = r.url()
  if ((u.includes('/api/notes') || u.includes('/api/diagrams')) && (r.method() === 'POST' || r.method() === 'PUT')) {
    saves.push(r)
  }
})

/** 요청이 gzip으로, 평문 대비 충분히 작게 나갔는지 검사. */
async function checkCompressed(label, req, plainJson) {
  check(`${label} 요청 발생`, !!req)
  if (!req) return
  const headers = await req.allHeaders()
  const sent = req.postDataBuffer()?.length ?? Number(headers['content-length'] ?? NaN)
  const plain = Buffer.byteLength(plainJson)
  check(`${label} 본문이 gzip으로 전송`, headers['content-encoding'] === 'gzip', `content-encoding=${headers['content-encoding']}`)
  // 반복이 많은 메모는 99%까지, 줄마다 번호가 다른 차트 코드는 75% 안팎으로 줄어든다 —
  // 절반 미만이면 압축이 실제로 적용된 것이다
  check(`${label} 전송 크기가 평문의 절반 미만`, sent < plain / 2, `${sent}B (평문 ${plain}B)`)
}

// ---------- 메모 ----------
// 회사망에서 막히던 크기대(수십 KB)의 긴 메모
const memoText = `gzip-${TAG} ` + '회사망에서 막히던 긴 메모 내용입니다. '.repeat(1200)
const memoContent = memoText.trim() // MemoPage가 trim해서 보낸다

await page.goto(`${BASE}/memo`)
await page.waitForSelector('.memo-textarea', { timeout: 30000 })
await page.locator('.memo-textarea').fill(memoText)
await page.locator('.memo-composer .btn-primary').click()
await page.waitForSelector(`.memo-item:has-text("gzip-${TAG}")`, { timeout: 15000 })

await checkCompressed('메모 저장', saves.find((r) => r.url().includes('/api/notes')), JSON.stringify({ content: memoContent }))

const notes = await page.evaluate(() => fetch('/api/notes').then((r) => r.json()))
const savedNote = notes.find((n) => n.content.includes(`gzip-${TAG}`))
check('서버에 메모가 저장됨', !!savedNote)
check('서버 메모 내용이 원문과 정확히 일치 (압축 해제 무결성)', savedNote?.content === memoContent,
  `${savedNote?.content.length ?? 0}자 vs ${memoContent.length}자`)
check('화면 목록에 메모 표시', (await page.locator('.memo-item', { hasText: `gzip-${TAG}` }).count()) === 1)

// ---------- 다이어그램 ----------
const diagramTitle = `gzip-${TAG}`
const diagramCode = 'flowchart TD\n' + Array.from({ length: 300 }, (_, i) => `  N${i}[노드 ${i}] --> N${i + 1}`).join('\n')

await page.goto(`${BASE}/diagram`)
await page.waitForSelector('.mermaid-editor', { timeout: 30000 })
await page.waitForSelector('.mermaid-title-input', { timeout: 15000 }) // 서버 감지 후에만 저장 UI가 뜬다
await page.locator('.mermaid-editor').fill(diagramCode)
await page.locator('.mermaid-title-input').fill(diagramTitle)
await page.locator('.mermaid-toolbar .btn-primary').click()
await page.waitForSelector(`.mermaid-saved-load:has-text("${diagramTitle}")`, { timeout: 15000 })

await checkCompressed('차트 저장(POST)', saves.find((r) => r.url().includes('/api/diagrams') && r.method() === 'POST'),
  JSON.stringify({ title: diagramTitle, code: diagramCode }))

let diagrams = await page.evaluate(() => fetch('/api/diagrams').then((r) => r.json()))
const savedDiagram = diagrams.find((d) => d.title === diagramTitle)
check('서버에 차트가 저장됨', !!savedDiagram)
check('서버 차트 코드가 원문과 정확히 일치', savedDiagram?.code === diagramCode,
  `${savedDiagram?.code.length ?? 0}자 vs ${diagramCode.length}자`)

// 수정 저장(PUT)도 같은 경로를 지난다
const updatedCode = diagramCode + '\n  N300 --> END[끝]'
await page.locator('.mermaid-editor').fill(updatedCode)
await page.locator('.mermaid-toolbar .btn-primary', { hasText: '수정 저장' }).click()
await page.waitForTimeout(1500)
await checkCompressed('차트 수정(PUT)', saves.find((r) => r.url().includes('/api/diagrams') && r.method() === 'PUT'),
  JSON.stringify({ title: diagramTitle, code: updatedCode }))
diagrams = await page.evaluate(() => fetch('/api/diagrams').then((r) => r.json()))
check('서버 차트가 수정 내용으로 갱신됨', diagrams.find((d) => d.title === diagramTitle)?.code === updatedCode)

// ---------- 정리 ----------
if (savedNote) await page.evaluate((id) => fetch(`/api/notes/${id}`, { method: 'DELETE' }), savedNote.id)
if (savedDiagram) await page.evaluate((id) => fetch(`/api/diagrams/${id}`, { method: 'DELETE' }), savedDiagram.id)

await browser.close()
console.log(failures === 0 ? '\n모든 검사 통과' : `\n실패 ${failures}건`)
process.exit(failures ? 1 : 0)
