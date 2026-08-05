import { useEffect, useRef, useState } from 'react'
import { FilePlus2, Trash2, Workflow } from 'lucide-react'
import type { DiagramDto } from '../diagramApi'
import * as diagramApi from '../diagramApi'
import { useConfirm } from './ConfirmDialog'

const DRAFT_KEY = 'kanban-mermaid-draft'

const SAMPLE = `flowchart TD
  A[브라우저 변경] --> B{백엔드 있음?}
  B -->|예| C[(PostgreSQL)]
  B -->|아니오| D[localStorage]
  C --> E[다른 기기 4초 폴링]
  D --> F[같은 브라우저 탭 간 동기화]`

/** 저장 전 편집 상태. 서버에서 불러온 차트를 고치던 중이면 id가 있다. */
interface Draft {
  id: number | null
  title: string
  code: string
}

// 새로고침해도 편집 중이던 내용이 날아가지 않도록 localStorage에 초안을 둔다.
// id/title까지 담는 이유: 코드만 복원하면 '수정'이던 편집이 '새로 저장'으로 바뀌어 사본이 생긴다.
function loadDraft(): Draft {
  let raw: string | null = null
  try {
    raw = localStorage.getItem(DRAFT_KEY)
  } catch {
    // localStorage 접근 불가
  }
  if (!raw) return { id: null, title: '', code: SAMPLE }
  try {
    const parsed = JSON.parse(raw) as Partial<Draft>
    if (typeof parsed?.code === 'string') {
      return {
        id: typeof parsed.id === 'number' ? parsed.id : null,
        title: typeof parsed.title === 'string' ? parsed.title : '',
        code: parsed.code,
      }
    }
  } catch {
    // 코드 문자열만 저장하던 구버전 초안
  }
  return { id: null, title: '', code: raw }
}

function currentTheme(): 'dark' | 'default' {
  return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'default'
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString('ko-KR', { dateStyle: 'medium', timeStyle: 'short' })
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : '오류가 발생했습니다'
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

/** mermaid 차트 실시간 편집 페이지. 편집 중 초안은 localStorage, 저장한 차트는 서버(DB). */
export function MermaidPage() {
  const [initial] = useState(loadDraft)
  const [code, setCode] = useState(initial.code)
  const [title, setTitle] = useState(initial.title)
  const [currentId, setCurrentId] = useState<number | null>(initial.id)
  const [svg, setSvg] = useState('')
  const [syntaxError, setSyntaxError] = useState<string | null>(null)
  const [diagrams, setDiagrams] = useState<DiagramDto[]>([])
  // 백엔드 없이도 편집·미리보기는 되어야 하므로, 목록 조회 실패는 저장 UI만 감춘다
  const [serverAvailable, setServerAvailable] = useState(true)
  const [serverError, setServerError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  // 타이핑 중 늦게 끝난 이전 렌더가 최신 결과를 덮어쓰지 않도록 하는 순번
  const seqRef = useRef(0)
  const { confirm } = useConfirm()

  useEffect(() => {
    diagramApi
      .listDiagrams()
      .then(setDiagrams)
      .catch(() => setServerAvailable(false))
  }, [])

  // 초안 저장 — 렌더와 분리해 제목만 바꿔도 다이어그램이 다시 그려지지 않게 한다
  useEffect(() => {
    const timer = setTimeout(() => {
      try {
        localStorage.setItem(DRAFT_KEY, JSON.stringify({ id: currentId, title, code }))
      } catch {
        // 저장 실패해도 편집은 계속 가능
      }
    }, 300)
    return () => clearTimeout(timer)
  }, [code, title, currentId])

  useEffect(() => {
    const source = code.trim()
    const timer = setTimeout(() => {
      const seq = ++seqRef.current
      if (!source) {
        setSvg('')
        setSyntaxError(null)
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
          setSyntaxError(null)
        } catch (e) {
          if (seq !== seqRef.current) return
          // 직전 미리보기는 그대로 둔다 — 타이핑 중 불완전한 문법마다 화면이 비면 편집이 어렵다
          setSyntaxError(e instanceof Error ? e.message : '다이어그램 문법 오류')
        }
      })()
    }, 300)
    return () => clearTimeout(timer)
  }, [code])

  async function handleSave() {
    const trimmed = title.trim()
    if (!trimmed || !code.trim()) return
    setSaving(true)
    setServerError(null)
    try {
      const saved = currentId
        ? await diagramApi.updateDiagram(currentId, trimmed, code)
        : await diagramApi.createDiagram(trimmed, code)
      setCurrentId(saved.id)
      // 수정이면 기존 항목을 걷어내고 맨 앞으로 — 서버의 최근 수정순 정렬과 맞춘다
      setDiagrams((prev) => [saved, ...prev.filter((d) => d.id !== saved.id)])
    } catch (e) {
      setServerError(errorMessage(e))
    } finally {
      setSaving(false)
    }
  }

  function handleLoad(d: DiagramDto) {
    setCurrentId(d.id)
    setTitle(d.title)
    setCode(d.code)
  }

  function handleNew() {
    setCurrentId(null)
    setTitle('')
    setCode('')
  }

  async function handleDelete(d: DiagramDto) {
    if (!(await confirm({ message: `'${d.title}' 차트를 삭제할까요?` }))) return
    try {
      await diagramApi.deleteDiagram(d.id)
      setDiagrams((prev) => prev.filter((x) => x.id !== d.id))
      // 편집 중이던 차트가 사라졌으면 '새로 저장' 모드로 — 없는 id에 PUT을 보내지 않도록
      if (currentId === d.id) setCurrentId(null)
    } catch (e) {
      setServerError(errorMessage(e))
    }
  }

  return (
    <div className="mermaid-page">
      <section className="mermaid-pane">
        <h2 className="memo-title">
          <Workflow size={18} /> mermaid 코드
        </h2>

        {serverAvailable && (
          <div className="mermaid-toolbar">
            <input
              className="mermaid-title-input"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="차트 제목"
              onKeyDown={(e) => {
                if (e.nativeEvent.isComposing) return
                if (e.key === 'Enter') handleSave()
              }}
            />
            <button className="btn btn-primary" onClick={handleSave} disabled={saving || !title.trim() || !code.trim()}>
              {currentId ? '수정 저장' : '저장'}
            </button>
            <button className="btn" onClick={handleNew} title="빈 차트로 시작">
              <FilePlus2 size={16} /> 새 차트
            </button>
          </div>
        )}
        {serverError && <div className="memo-error">{serverError}</div>}

        <textarea
          className="mermaid-editor"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          spellCheck={false}
          placeholder="flowchart TD&#10;  A --> B"
        />
        {syntaxError && <pre className="mermaid-error">{syntaxError}</pre>}

        {serverAvailable && (
          <div className="mermaid-saved">
            <h3 className="mermaid-saved-title">저장된 차트</h3>
            <ul className="memo-list">
              {diagrams.map((d) => (
                <li key={d.id} className={`mermaid-saved-item${d.id === currentId ? ' active' : ''}`}>
                  <button className="mermaid-saved-load" onClick={() => handleLoad(d)}>
                    <span className="mermaid-saved-name">{d.title}</span>
                    <span className="mermaid-saved-time">{formatTime(d.updatedAt)}</span>
                  </button>
                  <button className="memo-icon-btn" aria-label={`${d.title} 삭제`} onClick={() => handleDelete(d)}>
                    <Trash2 size={15} />
                  </button>
                </li>
              ))}
              {diagrams.length === 0 && <li className="memo-empty">저장된 차트가 없습니다.</li>}
            </ul>
          </div>
        )}
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
