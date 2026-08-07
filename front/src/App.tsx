import { useEffect, useMemo, useRef, useState } from 'react'
import { LogOut, Moon, Sun } from 'lucide-react'
import type { Filters } from './types'
import { EMPTY_FILTERS } from './types'
import { BoardProvider, useBoard } from './state/BoardContext'
import { isFilterActive } from './filtering'
import { collectAssignees } from './utils'
import { useTheme } from './hooks/useTheme'
import { BoardHeader } from './components/BoardHeader'
import { Board } from './components/Board'
import { CardModal } from './components/CardModal'
import { MemoPage } from './components/MemoPage'
import { MermaidPage } from './components/MermaidPage'
import { ToastProvider, useToast } from './components/Toast'
import { ConfirmProvider } from './components/ConfirmDialog'
import { AuthGate } from './components/AuthGate'

type View = 'board' | 'memo' | 'mermaid'

// 메모는 탭에서 감췄으므로 /memo 주소로만 들어온다. 나머지도 주소를 맞춰줘야
// 메모에서 다른 탭으로 옮긴 뒤 새로고침했을 때 메모로 되돌아가지 않는다.
const VIEW_PATHS: Record<View, string> = { board: '/', memo: '/memo', mermaid: '/diagram' }

function viewFromPath(): View {
  const path = window.location.pathname
  if (path === '/memo') return 'memo'
  if (path === '/diagram') return 'mermaid'
  return 'board'
}

function AppInner({ onLogout }: { onLogout: (() => void) | null }) {
  const { state, workspace } = useBoard()
  const { showToast } = useToast()
  // 테마 토글은 여기 한 곳에서만 호출 — useTheme은 Context가 아니라 로컬 state 훅이라
  // 두 컴포넌트가 각자 호출하면 상태가 갈라져 토글이 어긋난다
  const { theme, toggle: toggleTheme } = useTheme()

  // 동기화 충돌(다른 클라이언트가 먼저 저장) 시 BoardContext가 쏘는 알림
  useEffect(() => {
    function onConflict() {
      showToast('다른 기기의 변경과 충돌하여 최신 상태를 불러왔습니다')
    }
    window.addEventListener('kanban:sync-conflict', onConflict)
    return () => window.removeEventListener('kanban:sync-conflict', onConflict)
  }, [showToast])

  // 브라우저 뒤로/앞으로 가기
  useEffect(() => {
    function onPopState() {
      setView(viewFromPath())
    }
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [])
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS)
  const [selectedCardId, setSelectedCardId] = useState<string | null>(null)
  // 필터 활성 중 추가된 카드 — 필터와 무관하게 보여줘서 "추가했는데 사라짐" 오인을 방지.
  // 필터를 바꾸거나 보드를 전환하면 예외가 해제된다.
  const [filterExemptIds, setFilterExemptIds] = useState<string[]>([])
  const [view, setView] = useState<View>(viewFromPath)

  // 보드별 필터 기억 — 보드를 잠깐 전환했다 돌아와도 검색어·필터가 유지된다
  const filtersByBoard = useRef(new Map<string, Filters>())

  // 보드를 전환하면 이전 보드의 필터를 저장하고 새 보드의 필터를 복원, 선택 카드는 초기화.
  // useEffect는 페인트 후에 실행되어 이전 필터가 적용된 화면이 한 프레임 보이므로,
  // 렌더 중에 리셋하는 패턴(react.dev: adjusting state during render)을 쓴다.
  const [prevBoardId, setPrevBoardId] = useState(workspace.activeBoardId)
  if (prevBoardId !== workspace.activeBoardId) {
    filtersByBoard.current.set(prevBoardId, filters)
    setPrevBoardId(workspace.activeBoardId)
    setFilters(filtersByBoard.current.get(workspace.activeBoardId) ?? EMPTY_FILTERS)
    setSelectedCardId(null)
    setFilterExemptIds([])
  }

  // 라벨/담당자가 보드에서 삭제되면 필터에 남은 유령 id가 모든 카드를 숨기는 것을 방지
  const effectiveFilters = useMemo(() => {
    const labelIds = filters.labelIds.filter((id) => state.labels[id] !== undefined)
    const names = new Set(collectAssignees(state.cards))
    const assignees = filters.assignees.filter((name) => names.has(name))
    if (labelIds.length === filters.labelIds.length && assignees.length === filters.assignees.length) {
      return filters
    }
    return { ...filters, labelIds, assignees }
  }, [filters, state.labels, state.cards])

  // 유령 조건은 원본 상태에서도 제거 — 파생값에서만 걸러내면 UI는 '필터 없음'으로
  // 보이는데 숨은 필터가 살아 있다가, 같은 이름/라벨이 다시 생기는 순간 부활한다
  if (effectiveFilters !== filters) {
    setFilters(effectiveFilters)
  }

  function handleFiltersChange(next: Filters) {
    setFilterExemptIds([])
    setFilters(next)
  }

  function selectView(next: View) {
    setView(next)
    if (window.location.pathname !== VIEW_PATHS[next]) {
      window.history.pushState(null, '', VIEW_PATHS[next])
    }
  }

  function handleCardAdded(cardId: string) {
    if (isFilterActive(effectiveFilters)) {
      setFilterExemptIds((prev) => [...prev, cardId])
    }
  }

  const selectedCard = selectedCardId ? state.cards[selectedCardId] : undefined

  return (
    <div className="app">
      <nav className="app-nav">
        <button className={`app-tab${view === 'board' ? ' active' : ''}`} onClick={() => selectView('board')}>
          보드
        </button>
        <button className={`app-tab${view === 'mermaid' ? ' active' : ''}`} onClick={() => selectView('mermaid')}>
          다이어그램
        </button>
        {/* 메모는 탭에서 감춘 페이지 — /memo 주소로 접근한다. 들어와 있을 때만 탭을 보여
            현재 위치를 알리고, 다른 탭으로 나가면 다시 사라진다. */}
        {view === 'memo' && <span className="app-tab active">메모</span>}
        <button
          className="btn btn-icon theme-toggle"
          aria-label={theme === 'light' ? '다크 모드로 전환' : '라이트 모드로 전환'}
          title={theme === 'light' ? '다크 모드' : '라이트 모드'}
          onClick={toggleTheme}
        >
          {theme === 'light' ? <Moon size={18} /> : <Sun size={18} />}
        </button>
        {onLogout && (
          <button className="btn btn-icon" aria-label="로그아웃" title="로그아웃" onClick={onLogout}>
            <LogOut size={18} />
          </button>
        )}
      </nav>
      {view === 'board' ? (
        <>
          {/* key: 보드 전환 시 리마운트 — 제목 편집 draft 등 이전 보드의 헤더 상태가 남지 않도록 */}
          <BoardHeader key={workspace.activeBoardId} filters={effectiveFilters} onFiltersChange={handleFiltersChange} />
          <Board
            filters={effectiveFilters}
            filterExemptIds={filterExemptIds}
            onCardClick={setSelectedCardId}
            onCardAdded={handleCardAdded}
            onClearFilters={() => handleFiltersChange(EMPTY_FILTERS)}
          />
          {selectedCard && (
            <CardModal key={selectedCard.id} card={selectedCard} onClose={() => setSelectedCardId(null)} />
          )}
        </>
      ) : view === 'memo' ? (
        <MemoPage />
      ) : (
        <MermaidPage theme={theme} />
      )}
    </div>
  )
}

export default function App() {
  // AuthGate가 바깥에 있어야 로그인 전에 BoardProvider가 마운트되지 않는다 —
  // 로그인 화면 뒤에서 워크스페이스를 불러오거나 4초 폴링을 돌리지 않게 하기 위함.
  return (
    <AuthGate>
      {(onLogout) => (
        <BoardProvider>
          <ToastProvider>
            <ConfirmProvider>
              <AppInner onLogout={onLogout} />
            </ConfirmProvider>
          </ToastProvider>
        </BoardProvider>
      )}
    </AuthGate>
  )
}
