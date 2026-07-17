import { useRef, useState } from 'react'
import { Check, ChevronDown, ChevronUp, Kanban, Trash2 } from 'lucide-react'
import { useBoard } from '../state/BoardContext'
import { useClickOutside } from '../hooks/useClickOutside'
import { useUndoableDelete } from '../hooks/useUndoableDelete'
import { useConfirm } from './ConfirmDialog'
import { createEmptyBoard } from '../seed'
import { uid } from '../utils'

export function BoardSwitcher() {
  const { workspace, dispatch } = useBoard()
  const undoableDelete = useUndoableDelete()
  const { confirm } = useConfirm()
  const [open, setOpen] = useState(false)
  const [newName, setNewName] = useState('')
  const popoverRef = useRef<HTMLDivElement>(null)

  useClickOutside(popoverRef, open, () => setOpen(false))

  function createBoard() {
    const title = newName.trim()
    if (!title) return
    dispatch({ type: 'CREATE_BOARD', boardId: `board-${uid()}`, board: createEmptyBoard(title) })
    setNewName('')
    setOpen(false)
  }

  async function deleteBoard(boardId: string, title: string) {
    const board = workspace.boards[boardId]
    if (!board) return
    const columnCount = board.columnOrder.length
    const cardCount = Object.keys(board.cards).length
    const scale =
      columnCount > 0 || cardCount > 0 ? `\n컬럼 ${columnCount}개, 카드 ${cardCount}개가 함께 삭제됩니다.` : ''
    if (await confirm({ message: `'${title}' 보드를 삭제할까요?${scale}` })) {
      undoableDelete({ type: 'DELETE_BOARD', boardId }, `'${title}' 보드를 삭제했습니다`)
    }
  }

  return (
    <div
      className="board-switcher"
      ref={popoverRef}
      onKeyDown={(e) => {
        if (e.key === 'Escape' && !e.nativeEvent.isComposing && open) {
          e.stopPropagation()
          setOpen(false)
        }
      }}
    >
      <button
        className={`btn btn-subtle${open ? ' active' : ''}`}
        aria-label="보드 전환"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <Kanban size={16} />
        보드
        <ChevronDown size={14} />
      </button>

      {open && (
        <div className="menu-popover board-switcher-popover">
          <div className="board-switcher-list">
            {workspace.boardOrder.map((boardId, index) => {
              const board = workspace.boards[boardId]
              if (!board) return null
              const isActive = boardId === workspace.activeBoardId
              return (
                <div key={boardId} className="board-switcher-row">
                  <button
                    className={`menu-item${isActive ? ' board-switcher-active' : ''}`}
                    onClick={() => {
                      dispatch({ type: 'SELECT_BOARD', boardId })
                      setOpen(false)
                    }}
                  >
                    <span className="board-switcher-check">{isActive && <Check size={14} />}</span>
                    <span className="board-switcher-name">{board.boardTitle}</span>
                    <span className="board-switcher-count">{Object.keys(board.cards).length}</span>
                  </button>
                  {workspace.boardOrder.length > 1 && (
                    <>
                      <button
                        className="btn btn-icon btn-sm"
                        aria-label={`${board.boardTitle} 보드를 위로 이동`}
                        title="위로 이동"
                        disabled={index === 0}
                        onClick={() => dispatch({ type: 'MOVE_BOARD', boardId, toIndex: index - 1 })}
                      >
                        <ChevronUp size={13} />
                      </button>
                      <button
                        className="btn btn-icon btn-sm"
                        aria-label={`${board.boardTitle} 보드를 아래로 이동`}
                        title="아래로 이동"
                        disabled={index === workspace.boardOrder.length - 1}
                        onClick={() => dispatch({ type: 'MOVE_BOARD', boardId, toIndex: index + 1 })}
                      >
                        <ChevronDown size={13} />
                      </button>
                      <button
                        className="btn btn-icon btn-sm"
                        aria-label={`${board.boardTitle} 보드 삭제`}
                        title="보드 삭제"
                        onClick={() => deleteBoard(boardId, board.boardTitle)}
                      >
                        <Trash2 size={13} />
                      </button>
                    </>
                  )}
                </div>
              )
            })}
          </div>
          <div className="board-create">
            <input
              placeholder="새 보드 이름"
              maxLength={60}
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.nativeEvent.isComposing) createBoard()
              }}
            />
            <button className="btn btn-primary btn-sm" onClick={createBoard} disabled={!newName.trim()}>
              만들기
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
