import { useEffect, useRef, useState } from 'react'
import { Workflow } from 'lucide-react'

const DRAFT_KEY = 'kanban-mermaid-draft'

const SAMPLE = `flowchart TD
  A[브라우저 변경] --> B{백엔드 있음?}
  B -->|예| C[(PostgreSQL)]
  B -->|아니오| D[localStorage]
  C --> E[다른 기기 4초 폴링]
  D --> F[같은 브라우저 탭 간 동기화]`

function loadDraft(): string {
  try {
    return localStorage.getItem(DRAFT_KEY) ?? SAMPLE
  } catch {
    return SAMPLE
  }
}

function currentTheme(): 'dark' | 'default' {
  return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'default'
}

// mermaid는 번들이 커서(수백 KB) 정적 import하면 보드만 쓰는 사용자도 내려받게 된다.
// 이 페이지를 처음 열 때만 로드하고, 모듈 수준에서 약속을 캐시해 재방문 시 재사용한다.
let mermaidPromise: Promise<typeof import('mermaid').default> | null = null
function getMermaid() {
  if (!mermaidPromise) {
    mermaidPromise = import('mermaid').then((m) => m.default)
  }
  return mermaidPromise
}

/** mermaid 다이어그램 실시간 편집 페이지 (초안은 localStorage에만 보관). */
export function MermaidPage() {
  const [code, setCode] = useState(loadDraft)
  const [svg, setSvg] = useState('')
  const [error, setError] = useState<string | null>(null)
  // 타이핑 중 늦게 끝난 이전 렌더가 최신 결과를 덮어쓰지 않도록 하는 순번
  const seqRef = useRef(0)

  useEffect(() => {
    const source = code.trim()
    const timer = setTimeout(() => {
      try {
        localStorage.setItem(DRAFT_KEY, code)
      } catch {
        // 저장 실패해도 편집은 계속 가능
      }
      const seq = ++seqRef.current
      if (!source) {
        setSvg('')
        setError(null)
        return
      }
      void (async () => {
        try {
          const mermaid = await getMermaid()
          // 테마는 매번 주입 — 다크 모드를 토글하고 돌아와도 미리보기가 따라간다.
          // suppressErrorRendering: 실패 시 mermaid가 DOM에 에러 다이어그램을 심는 것을 막는다.
          mermaid.initialize({ startOnLoad: false, suppressErrorRendering: true, theme: currentTheme() })
          await mermaid.parse(source)
          const { svg: rendered } = await mermaid.render(`mermaid-preview-${seq}`, source)
          if (seq !== seqRef.current) return
          setSvg(rendered)
          setError(null)
        } catch (e) {
          if (seq !== seqRef.current) return
          // 직전 미리보기는 그대로 둔다 — 타이핑 중 불완전한 문법마다 화면이 비면 편집이 어렵다
          setError(e instanceof Error ? e.message : '다이어그램 문법 오류')
        }
      })()
    }, 300)
    return () => clearTimeout(timer)
  }, [code])

  return (
    <div className="mermaid-page">
      <section className="mermaid-pane">
        <h2 className="memo-title">
          <Workflow size={18} /> mermaid 코드
        </h2>
        <textarea
          className="mermaid-editor"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          spellCheck={false}
          placeholder="flowchart TD&#10;  A --> B"
        />
        {error && <pre className="mermaid-error">{error}</pre>}
      </section>

      <section className="mermaid-pane">
        <h2 className="memo-title">미리보기</h2>
        <div className="mermaid-preview">
          {svg ? (
            // mermaid가 만든 SVG. 기본 securityLevel 'strict'로 라벨의 HTML이 살균된다.
            <div className="mermaid-svg" dangerouslySetInnerHTML={{ __html: svg }} />
          ) : (
            <p className="memo-empty">{code.trim() ? '렌더링 중…' : 'mermaid 코드를 입력하세요.'}</p>
          )}
        </div>
      </section>
    </div>
  )
}
