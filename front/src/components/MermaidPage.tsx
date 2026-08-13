import { useCallback, useEffect, useRef, useState } from 'react'
import { Expand, FilePlus2, Maximize, Minimize2, Scan, Trash2, Workflow, ZoomIn, ZoomOut } from 'lucide-react'
import type { DiagramDto } from '../diagramApi'
import * as diagramApi from '../diagramApi'
import type { Theme } from '../hooks/useTheme'
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

/**
 * mermaid 기본 테마는 시인성이 약하다 — 라이트는 연보라 노드에 흐린 테두리,
 * 다크는 노드가 배경과 명도가 비슷해 뭉개진다. 'base' 테마 위에 앱 팔레트
 * (index.css의 Atlassian 토큰)를 얹어 노드가 배경에서 확실히 떠 보이게 한다.
 * base는 지정하지 않은 색을 여기서 파생시키므로 핵심 변수만 준다.
 */
const THEME_VARIABLES = {
  light: {
    background: '#f1f2f4', // 미리보기 배경(--column-bg)과 일치
    primaryColor: '#ffffff', // 노드는 흰 카드 — 회색 배경 위에서 떠 보인다
    primaryTextColor: '#172b4d',
    primaryBorderColor: '#0c66e4',
    lineColor: '#44546f',
    // 지정하지 않으면 시퀀스·간트 등이 lineColor 계열에서 흐린 색을 파생시킨다
    textColor: '#172b4d',
    actorTextColor: '#172b4d',
    signalTextColor: '#172b4d',
    secondaryColor: '#e9f2ff',
    tertiaryColor: '#f7f8f9',
    clusterBkg: '#e9f2ff',
    clusterBorder: '#8fb8f6',
    edgeLabelBackground: '#ffffff',
    noteBkgColor: '#fff7d6',
    noteTextColor: '#172b4d',
    noteBorderColor: '#e2b203',
  },
  dark: {
    background: '#1d2125',
    // 노드는 배경(#1d2125)과 확실히 벌어져야 한다. #2c333a는 대비 1.27:1로
    // 사실상 배경과 붙어 보여 테두리만 뜨고 전체가 뭉개졌다. #454f59는 배경 대비
    // 1.95:1로 형태가 살면서, 텍스트(#f1f5f9)와는 7.3:1을 확보한다.
    primaryColor: '#454f59',
    primaryTextColor: '#f1f5f9',
    primaryBorderColor: '#85b8ff',
    lineColor: '#b6c2cf',
    // 지정하지 않으면 시퀀스·간트 등이 lineColor 계열에서 흐린 색을 파생시킨다
    textColor: '#f1f5f9',
    actorTextColor: '#f1f5f9',
    signalTextColor: '#f1f5f9',
    secondaryColor: '#23395e',
    tertiaryColor: '#2c333a',
    clusterBkg: '#2c333a',
    clusterBorder: '#5a6572',
    edgeLabelBackground: '#1d2125',
    noteBkgColor: '#4a3f1a',
    noteTextColor: '#f1f5f9',
    noteBorderColor: '#cf9f02',
  },
}

/** WCAG 상대 휘도. */
function luminance(r: number, g: number, b: number): number {
  const f = (c: number) => {
    const s = c / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
}

const DARK_INK = '#172b4d'
const LIGHT_INK = '#f1f5f9'
const DARK_INK_LUM = luminance(23, 43, 77)
const LIGHT_INK_LUM = luminance(241, 245, 249)

/** 배경색 위에서 대비가 더 큰 글자색을 고른다. 판별 불가하면 null. */
function inkFor(fill: string): string | null {
  const n = fill.match(/\d+(\.\d+)?/g)
  if (!n || n.length < 3) return null
  if (n.length >= 4 && Number(n[3]) === 0) return null // 투명
  const bg = luminance(Number(n[0]), Number(n[1]), Number(n[2]))
  const contrast = (ink: number) => (Math.max(ink, bg) + 0.05) / (Math.min(ink, bg) + 0.05)
  return contrast(DARK_INK_LUM) >= contrast(LIGHT_INK_LUM) ? DARK_INK : LIGHT_INK
}

/**
 * 노드 글자색을 실제 칠해진 배경에 맞춰 SVG 문자열에 미리 구워 넣는다.
 *
 * 렌더된 뒤 DOM을 직접 고치는 방식은 쓸 수 없다 — 확대·이동으로 리렌더되면
 * React가 dangerouslySetInnerHTML을 다시 써서 나중에 입힌 인라인 스타일이
 * 통째로 날아간다(첫 렌더 직후에만 맞고 조작하는 순간 원래대로 돌아간다).
 * 그래서 화면 밖 컨테이너에 잠깐 붙여 계산색을 읽고, 고친 결과를 문자열로
 * 되돌려 state에 넣는다. mermaid가 SVG 안에 style을 함께 넣어주므로
 * 떼어놓은 컨테이너에서도 실제 채움색이 그대로 계산된다.
 */
function bakeInk(markup: string): string {
  const holder = document.createElement('div')
  holder.style.cssText = 'position:absolute;left:-99999px;top:0;visibility:hidden'
  holder.innerHTML = markup
  document.body.appendChild(holder)
  try {
    for (const node of holder.querySelectorAll('.node, .cluster')) {
      // label-container가 진짜 배경 도형이다. 없을 때만 첫 도형으로 넘어간다
      // (라벨 뒤에 깔리는 보조 rect를 배경으로 오인하지 않도록).
      const shape =
        node.querySelector('.label-container') ?? node.querySelector('rect, polygon, ellipse, circle, path')
      if (!shape) continue
      const ink = inkFor(getComputedStyle(shape).fill)
      if (!ink) continue
      for (const el of node.querySelectorAll<HTMLElement>('.nodeLabel, .cluster-label, span, p, text, tspan')) {
        el.style.color = ink
        el.style.fill = ink
      }
    }
    // mermaid는 SVG를 width:100%로 내보내 큰 차트일수록 패널 폭에 맞춰 축소된다 —
    // 글자가 잘게 뭉개지고 배율 표시(100%)도 거짓이 된다. viewBox의 실제 크기를
    // width/height로 박아 배율 1 = 실제 크기(글자 원래 크기)가 되게 한다.
    const svgEl = holder.querySelector('svg')
    const viewBox = svgEl?.viewBox?.baseVal
    if (svgEl && viewBox && viewBox.width > 0) {
      svgEl.setAttribute('width', String(viewBox.width))
      svgEl.setAttribute('height', String(viewBox.height))
      svgEl.style.maxWidth = 'none'
    }
    return holder.innerHTML
  } finally {
    holder.remove()
  }
}

const MIN_SCALE = 0.05
const MAX_SCALE = 30
const IDENTITY_VIEW = { scale: 1, x: 0, y: 0 }

function clampScale(s: number): number {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, s))
}

const SPLIT_KEY = 'kanban-mermaid-split'
const MIN_SPLIT = 20
const MAX_SPLIT = 80

function clampSplit(pct: number): number {
  return Math.min(MAX_SPLIT, Math.max(MIN_SPLIT, pct))
}

/** 좌우 패널 비율(왼쪽 %) — 새로고침해도 조정한 폭이 유지되게 보관한다. */
function loadSplit(): number {
  try {
    const raw = localStorage.getItem(SPLIT_KEY)
    if (raw) {
      const pct = Number(raw)
      if (Number.isFinite(pct)) return clampSplit(pct)
    }
  } catch {
    // localStorage 접근 불가
  }
  return 50
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

interface MermaidPageProps {
  /** 테마를 prop으로 받아 렌더 의존성에 넣는다 — DOM에서 읽으면 토글해도 다시 그리지 않는다 */
  theme: Theme
}

/** mermaid 차트 실시간 편집 페이지. 편집 중 초안은 localStorage, 저장한 차트는 서버(DB). */
export function MermaidPage({ theme }: MermaidPageProps) {
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
  // 저장 중복 방지는 state가 아니라 ref로 — 제목칸 Enter 연타는 리렌더 사이에 연달아
  // 들어와 saving state가 아직 true가 아니어서, 같은 차트가 여러 벌 저장된다
  const savingRef = useRef(false)
  // 타이핑 중 늦게 끝난 이전 렌더가 최신 결과를 덮어쓰지 않도록 하는 순번
  const seqRef = useRef(0)
  // 미리보기 확대/이동. transform-origin이 center라 배율 1·오프셋 0이면 기존 중앙 정렬 그대로다
  const [view, setView] = useState(IDENTITY_VIEW)
  const [dragging, setDragging] = useState(false)
  const viewportRef = useRef<HTMLDivElement>(null)
  const dragStart = useRef({ x: 0, y: 0, ox: 0, oy: 0 })
  // 좌우 패널 비율(왼쪽 %) — 분할선 드래그로 조정
  const [splitPct, setSplitPct] = useState(loadSplit)
  const [resizing, setResizing] = useState(false)
  const pageRef = useRef<HTMLDivElement>(null)
  const resizeStart = useRef({ x: 0, pct: 50, track: 0 })
  // 새로 그려진/불러온 차트는 전체 구조가 보이도록 화면 맞춤으로 시작
  const needsFitRef = useRef(true)
  const [fullscreen, setFullscreen] = useState(false)
  const { confirm } = useConfirm()

  /** 차트 전체가 패널에 들어오는 배율로 (실제 크기 100%를 넘지는 않게). */
  const fitToPane = useCallback(() => {
    const viewport = viewportRef.current
    const svgEl = viewport?.querySelector('.mermaid-svg svg')
    if (!viewport || !svgEl) return
    const w = Number(svgEl.getAttribute('width'))
    const h = Number(svgEl.getAttribute('height'))
    if (!w || !h) {
      setView(IDENTITY_VIEW)
      return
    }
    const pw = viewport.clientWidth - 16
    const ph = viewport.clientHeight - 16
    setView({ scale: clampScale(Math.min(pw / w, ph / h, 1)), x: 0, y: 0 })
  }, [])

  // 첫 렌더/불러오기 직후에만 화면 맞춤 — 편집 중 재렌더에는 시점을 유지한다
  useEffect(() => {
    if (!svg || !needsFitRef.current) return
    needsFitRef.current = false
    fitToPane()
  }, [svg, fitToPane])

  // 전체 화면 전환 시 새 크기에 맞춰 다시 맞춤 (명시적 조작이라 시점이 바뀌어도 자연스럽다)
  useEffect(() => {
    const id = requestAnimationFrame(fitToPane)
    return () => cancelAnimationFrame(id)
  }, [fullscreen, fitToPane])

  // Esc로 전체 화면 종료 — confirm 레이어가 떠 있으면 양보(Esc 우선순위 규약)
  useEffect(() => {
    if (!fullscreen) return
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'Escape' || e.isComposing) return
      if (document.querySelector('.confirm-backdrop')) return
      setFullscreen(false)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [fullscreen])

  /** (dx, dy)는 뷰포트 중심 기준 좌표 — 그 지점을 고정한 채 배율만 바꾼다. */
  const zoomAt = useCallback((factor: number, dx: number, dy: number) => {
    setView((v) => {
      const scale = clampScale(v.scale * factor)
      // 한도에 걸리면 k가 1이 되어 확대도 이동도 멈춘다
      const k = scale / v.scale
      return { scale, x: dx * (1 - k) + v.x * k, y: dy * (1 - k) + v.y * k }
    })
  }, [])

  // 휠 줌은 리스너를 직접 붙인다 — React의 onWheel은 passive로 등록되어
  // preventDefault가 먹지 않고, 확대할 때 페이지가 같이 스크롤된다.
  useEffect(() => {
    const el = viewportRef.current
    if (!el) return
    function onWheel(this: HTMLDivElement, e: WheelEvent) {
      // 그려진 그림이 없으면 무시 — 빈 화면에서 굴린 배율이 쌓여 있다가
      // 코드를 입력하는 순간 엉뚱한 배율로 나타난다. DOM을 직접 보므로
      // 리스너를 다시 붙이지 않아도 최신 상태를 반영한다.
      if (!this.querySelector('.mermaid-svg')) return
      e.preventDefault()
      const rect = this.getBoundingClientRect()
      zoomAt(
        Math.exp(-e.deltaY * 0.002),
        e.clientX - rect.left - rect.width / 2,
        e.clientY - rect.top - rect.height / 2,
      )
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [zoomAt])

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
          // suppressErrorRendering: 실패 시 mermaid가 DOM에 에러 다이어그램을 심는 것을 막는다
          mermaid.initialize({
            startOnLoad: false,
            suppressErrorRendering: true,
            theme: 'base',
            themeVariables: {
              fontFamily:
                "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Noto Sans KR', 'Malgun Gothic', sans-serif",
              ...THEME_VARIABLES[theme],
            },
          })
          await mermaid.parse(source)
          const { svg: rendered } = await mermaid.render(`mermaid-preview-${seq}`, source)
          if (seq !== seqRef.current) return
          setSvg(bakeInk(rendered))
          setSyntaxError(null)
        } catch (e) {
          if (seq !== seqRef.current) return
          // 직전 미리보기는 그대로 둔다 — 타이핑 중 불완전한 문법마다 화면이 비면 편집이 어렵다
          setSyntaxError(e instanceof Error ? e.message : '다이어그램 문법 오류')
        }
      })()
    }, 300)
    return () => clearTimeout(timer)
    // theme이 바뀌면 같은 코드라도 다시 그린다 — mermaid는 렌더 시점의 테마를 SVG에 구워 넣는다
  }, [code, theme])

  async function handleSave() {
    const trimmed = title.trim()
    if (savingRef.current || !trimmed || !code.trim()) return
    savingRef.current = true
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
      savingRef.current = false
      setSaving(false)
    }
  }

  function handleLoad(d: DiagramDto) {
    setCurrentId(d.id)
    setTitle(d.title)
    setCode(d.code)
    needsFitRef.current = true // 다음 렌더에서 화면 맞춤 — 이전 차트의 시점을 물려받지 않게
  }

  function handleNew() {
    setCurrentId(null)
    setTitle('')
    setCode('')
    needsFitRef.current = true
  }

  function handleDragStart(e: React.PointerEvent<HTMLDivElement>) {
    if (e.button !== 0) return
    e.currentTarget.setPointerCapture(e.pointerId)
    dragStart.current = { x: e.clientX, y: e.clientY, ox: view.x, oy: view.y }
    setDragging(true)
  }

  function handleDragMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!dragging) return
    const start = dragStart.current
    setView((v) => ({ ...v, x: start.ox + (e.clientX - start.x), y: start.oy + (e.clientY - start.y) }))
  }

  function handleDragEnd(e: React.PointerEvent<HTMLDivElement>) {
    if (!dragging) return
    e.currentTarget.releasePointerCapture(e.pointerId)
    setDragging(false)
  }

  function applySplit(pct: number) {
    const next = clampSplit(pct)
    setSplitPct(next)
    try {
      localStorage.setItem(SPLIT_KEY, String(next))
    } catch {
      // 저장 실패해도 이번 세션에는 적용
    }
  }

  // 포인터를 분할선에 잡아둔다 — 커서가 미리보기 위를 지나가도 그쪽 pan 핸들러가
  // 반응해 다이어그램이 딸려 움직이지 않는다
  function handleResizeStart(e: React.PointerEvent<HTMLDivElement>) {
    if (e.button !== 0) return
    e.currentTarget.setPointerCapture(e.pointerId)
    // 두 패널의 실제 너비 합(=fr이 나눠 갖는 트랙)을 기준으로 상대 이동을 계산한다.
    // 컨테이너 전체 폭으로 절대 위치를 계산하면 padding·gap·분할선 두께만큼
    // 커서와 분할선이 어긋난다(300px 끌면 약 16px 오차).
    const panes = pageRef.current?.querySelectorAll('.mermaid-pane')
    const track =
      panes && panes.length === 2
        ? panes[0].getBoundingClientRect().width + panes[1].getBoundingClientRect().width
        : 0
    resizeStart.current = { x: e.clientX, pct: splitPct, track }
    setResizing(true)
  }

  function handleResizeMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!resizing) return
    const { x, pct, track } = resizeStart.current
    if (track <= 0) return
    applySplit(pct + ((e.clientX - x) / track) * 100)
  }

  function handleResizeEnd(e: React.PointerEvent<HTMLDivElement>) {
    if (!resizing) return
    e.currentTarget.releasePointerCapture(e.pointerId)
    setResizing(false)
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
    <div
      ref={pageRef}
      className={`mermaid-page${resizing ? ' resizing' : ''}`}
      style={{ gridTemplateColumns: `${splitPct}fr 6px ${100 - splitPct}fr` }}
    >
      <section className="mermaid-pane">
        <h2 className="memo-title">
          <Workflow size={18} /> mermaid 코드
        </h2>

        {serverAvailable && (
          <div className="mermaid-toolbar">
            <input
              className="mermaid-title-input"
              maxLength={200}
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

      <div
        className="mermaid-divider"
        role="separator"
        aria-orientation="vertical"
        aria-label="코드·미리보기 너비 조절"
        aria-valuenow={Math.round(splitPct)}
        aria-valuemin={MIN_SPLIT}
        aria-valuemax={MAX_SPLIT}
        tabIndex={0}
        onPointerDown={handleResizeStart}
        onPointerMove={handleResizeMove}
        onPointerUp={handleResizeEnd}
        onPointerCancel={handleResizeEnd}
        onKeyDown={(e) => {
          if (e.key === 'ArrowLeft') applySplit(splitPct - 2)
          else if (e.key === 'ArrowRight') applySplit(splitPct + 2)
          else return
          e.preventDefault()
        }}
        onDoubleClick={() => applySplit(50)}
        title="드래그해 너비 조절 (더블클릭: 5:5)"
      />

      <section className="mermaid-pane">
        <h2 className="memo-title">미리보기</h2>
        <div
          ref={viewportRef}
          className={`mermaid-preview${svg ? ' pannable' : ''}${dragging ? ' dragging' : ''}${fullscreen ? ' fullscreen' : ''}`}
          onPointerDown={svg ? handleDragStart : undefined}
          onPointerMove={handleDragMove}
          onPointerUp={handleDragEnd}
          onPointerCancel={handleDragEnd}
        >
          {svg ? (
            <>
              {/* mermaid가 만든 SVG. 기본 securityLevel 'strict'로 라벨의 HTML이 살균된다. */}
              <div
                className="mermaid-svg"
                style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})` }}
                dangerouslySetInnerHTML={{ __html: svg }}
              />
              {/* 컨트롤 클릭이 뷰포트의 드래그 시작으로 번지지 않게 차단 */}
              <div className="mermaid-zoom" onPointerDown={(e) => e.stopPropagation()}>
                <button className="btn btn-icon" aria-label="확대" onClick={() => zoomAt(1.25, 0, 0)}>
                  <ZoomIn size={16} />
                </button>
                <button className="btn btn-icon" aria-label="축소" onClick={() => zoomAt(1 / 1.25, 0, 0)}>
                  <ZoomOut size={16} />
                </button>
                <button className="btn btn-icon" aria-label="화면 맞춤" title="화면 맞춤 — 전체 구조 보기" onClick={fitToPane}>
                  <Scan size={16} />
                </button>
                <button className="btn btn-icon" aria-label="실제 크기" title="실제 크기(100%) — 글자 원래 크기" onClick={() => setView(IDENTITY_VIEW)}>
                  <Maximize size={16} />
                </button>
                <button
                  className="btn btn-icon"
                  aria-label={fullscreen ? '전체 화면 종료' : '전체 화면'}
                  title={fullscreen ? '전체 화면 종료 (Esc)' : '전체 화면'}
                  onClick={() => setFullscreen((f) => !f)}
                >
                  {fullscreen ? <Minimize2 size={16} /> : <Expand size={16} />}
                </button>
                <span className="mermaid-zoom-level">{Math.round(view.scale * 100)}%</span>
              </div>
            </>
          ) : (
            <p className="memo-empty">{code.trim() ? '렌더링 중…' : 'mermaid 코드를 입력하세요.'}</p>
          )}
        </div>
      </section>
    </div>
  )
}
