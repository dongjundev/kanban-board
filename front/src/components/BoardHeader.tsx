import { useMemo, useRef, useState } from 'react'
import { ChevronDown, Moon, Search, Sun, X } from 'lucide-react'
import type { Filters } from '../types'
import { EMPTY_FILTERS } from '../types'
import { useBoard } from '../state/BoardContext'
import { isFilterActive } from '../filtering'
import { collectAssignees } from '../utils'
import { useClickOutside } from '../hooks/useClickOutside'
import { useTheme } from '../hooks/useTheme'
import { Avatar } from './Avatar'
import { BoardSwitcher } from './BoardSwitcher'

interface BoardHeaderProps {
  filters: Filters
  onFiltersChange: (filters: Filters) => void
}

/** 이 수를 넘는 담당자는 +N 버튼 뒤의 드롭다운으로 축약 */
const MAX_VISIBLE_ASSIGNEES = 5

export function BoardHeader({ filters, onFiltersChange }: BoardHeaderProps) {
  const { state, dispatch } = useBoard()
  const { theme, toggle: toggleTheme } = useTheme()
  const [editingTitle, setEditingTitle] = useState(false)
  const [titleDraft, setTitleDraft] = useState(state.boardTitle)
  const [labelMenuOpen, setLabelMenuOpen] = useState(false)
  const labelMenuRef = useRef<HTMLDivElement>(null)
  const [assigneeMenuOpen, setAssigneeMenuOpen] = useState(false)
  const assigneeMenuRef = useRef<HTMLDivElement>(null)

  useClickOutside(labelMenuRef, labelMenuOpen, () => setLabelMenuOpen(false))
  useClickOutside(assigneeMenuRef, assigneeMenuOpen, () => setAssigneeMenuOpen(false))

  const assignees = useMemo(() => collectAssignees(state.cards), [state.cards])

  const allLabels = Object.values(state.labels)

  function commitTitle() {
    setEditingTitle(false)
    if (titleDraft.trim() && titleDraft.trim() !== state.boardTitle) {
      dispatch({ type: 'SET_BOARD_TITLE', title: titleDraft })
    } else {
      setTitleDraft(state.boardTitle)
    }
  }

  function toggleAssignee(name: string) {
    const next = filters.assignees.includes(name)
      ? filters.assignees.filter((n) => n !== name)
      : [...filters.assignees, name]
    onFiltersChange({ ...filters, assignees: next })
  }

  function toggleLabel(labelId: string) {
    const next = filters.labelIds.includes(labelId)
      ? filters.labelIds.filter((id) => id !== labelId)
      : [...filters.labelIds, labelId]
    onFiltersChange({ ...filters, labelIds: next })
  }

  return (
    <header className="board-header">
      <BoardSwitcher />
      {editingTitle ? (
        <input
          className="board-title-input"
          autoFocus
          value={titleDraft}
          onChange={(e) => setTitleDraft(e.target.value)}
          onBlur={commitTitle}
          onKeyDown={(e) => {
            if (e.nativeEvent.isComposing) return
            if (e.key === 'Enter') commitTitle()
            else if (e.key === 'Escape') {
              setTitleDraft(state.boardTitle)
              setEditingTitle(false)
            }
          }}
        />
      ) : (
        <h1
          className="board-title"
          title="클릭해서 이름 바꾸기"
          role="button"
          tabIndex={0}
          onClick={() => {
            setTitleDraft(state.boardTitle)
            setEditingTitle(true)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault()
              setTitleDraft(state.boardTitle)
              setEditingTitle(true)
            }
          }}
        >
          {state.boardTitle}
        </h1>
      )}

      <div className="header-tools">
        <div className="search-box">
          <Search size={16} />
          <input
            type="search"
            placeholder="카드 검색"
            value={filters.query}
            onChange={(e) => onFiltersChange({ ...filters, query: e.target.value })}
          />
        </div>

        {assignees.length > 0 && (
          <div className="assignee-filter" ref={assigneeMenuRef}>
            {assignees.slice(0, MAX_VISIBLE_ASSIGNEES).map((name) => (
              <button
                key={name}
                className={`assignee-toggle${filters.assignees.includes(name) ? ' selected' : ''}`}
                onClick={() => toggleAssignee(name)}
                title={name}
              >
                <Avatar name={name} size={30} />
              </button>
            ))}
            {assignees.length > MAX_VISIBLE_ASSIGNEES && (
              <>
                <button
                  className={`assignee-toggle assignee-overflow${
                    filters.assignees.some((n) => assignees.indexOf(n) >= MAX_VISIBLE_ASSIGNEES) ? ' selected' : ''
                  }`}
                  aria-label="담당자 전체 보기"
                  aria-expanded={assigneeMenuOpen}
                  onClick={() => setAssigneeMenuOpen((v) => !v)}
                >
                  +{assignees.length - MAX_VISIBLE_ASSIGNEES}
                </button>
                {assigneeMenuOpen && (
                  <div className="menu-popover assignee-menu">
                    {assignees.map((name) => (
                      <label key={name} className="menu-item label-menu-item">
                        <input
                          type="checkbox"
                          checked={filters.assignees.includes(name)}
                          onChange={() => toggleAssignee(name)}
                        />
                        <Avatar name={name} size={20} />
                        {name}
                      </label>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {allLabels.length > 0 && (
          <div className="label-filter" ref={labelMenuRef}>
            <button
              className={`btn btn-subtle${filters.labelIds.length > 0 ? ' active' : ''}`}
              onClick={() => setLabelMenuOpen((v) => !v)}
            >
              라벨
              {filters.labelIds.length > 0 && <span className="filter-count">{filters.labelIds.length}</span>}
              <ChevronDown size={14} />
            </button>
            {labelMenuOpen && (
              <div className="menu-popover label-menu">
                {allLabels.map((label) => (
                  <label key={label.id} className="menu-item label-menu-item">
                    <input
                      type="checkbox"
                      checked={filters.labelIds.includes(label.id)}
                      onChange={() => toggleLabel(label.id)}
                    />
                    <span className="label-swatch" style={{ background: label.color }} />
                    {label.name}
                  </label>
                ))}
              </div>
            )}
          </div>
        )}

        {isFilterActive(filters) && (
          <button className="btn btn-subtle" onClick={() => onFiltersChange(EMPTY_FILTERS)}>
            <X size={14} />
            필터 초기화
          </button>
        )}

        <button
          className="btn btn-icon theme-toggle"
          aria-label={theme === 'light' ? '다크 모드로 전환' : '라이트 모드로 전환'}
          title={theme === 'light' ? '다크 모드' : '라이트 모드'}
          onClick={toggleTheme}
        >
          {theme === 'light' ? <Moon size={18} /> : <Sun size={18} />}
        </button>
      </div>
    </header>
  )
}
