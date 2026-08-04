import { useEffect, useMemo, useRef, useState } from 'react'
import type { Filters } from './types'
import { EMPTY_FILTERS } from './types'
import { BoardProvider, useBoard } from './state/BoardContext'
import { isFilterActive } from './filtering'
import { collectAssignees } from './utils'
import { BoardHeader } from './components/BoardHeader'
import { Board } from './components/Board'
import { CardModal } from './components/CardModal'
import { MemoPage } from './components/MemoPage'
import { ToastProvider, useToast } from './components/Toast'
import { ConfirmProvider } from './components/ConfirmDialog'

function AppInner() {
  const { state, workspace } = useBoard()
  const { showToast } = useToast()

  // 동기화 충돌(다른 클라이언트가 먼저 저장) 시 BoardContext가 쏘는 알림
  useEffect(() => {
    function onConflict() {
      showToast('다른 기기의 변경과 충돌하여 최신 상태를 불러왔습니다')
    }
    window.addEventListener('kanban:sync-conflict', onConflict)
    return () => window.removeEventListener('kanban:sync-conflict', onConflict)
  }, [showToast])
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS)
  const [selectedCardId, setSelectedCardId] = useState<string | null>(null)
  // 필터 활성 중 추가된 카드 — 필터와 무관하게 보여줘서 "추가했는데 사라짐" 오인을 방지.
  // 필터를 바꾸거나 보드를 전환하면 예외가 해제된다.
  const [filterExemptIds, setFilterExemptIds] = useState<string[]>([])
  const [view, setView] = useState<'board' | 'memo'>('board')

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

  function handleCardAdded(cardId: string) {
    if (isFilterActive(effectiveFilters)) {
      setFilterExemptIds((prev) => [...prev, cardId])
    }
  }

  const selectedCard = selectedCardId ? state.cards[selectedCardId] : undefined

  return (
    <div className="app">
      <nav className="app-nav">
        <button className={`app-tab${view === 'board' ? ' active' : ''}`} onClick={() => setView('board')}>
          보드
        </button>
        <button className={`app-tab${view === 'memo' ? ' active' : ''}`} onClick={() => setView('memo')}>
          메모
        </button>
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
      ) : (
        <MemoPage />
      )}
    </div>
  )
}

export default function App() {
  return (
    <BoardProvider>
      <ToastProvider>
        <ConfirmProvider>
          <AppInner />
        </ConfirmProvider>
      </ToastProvider>
    </BoardProvider>
  )
}
