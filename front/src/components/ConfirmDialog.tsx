import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { useFocusTrap } from '../hooks/useFocusTrap'

interface ConfirmOptions {
  message: string
}

interface ConfirmContextValue {
  /** 인앱 확인 다이얼로그를 띄우고 사용자의 선택을 반환 */
  confirm: (options: ConfirmOptions) => Promise<boolean>
}

const ConfirmContext = createContext<ConfirmContextValue | null>(null)

interface Pending {
  options: ConfirmOptions
  resolve: (result: boolean) => void
}

function ConfirmDialogView({ message, onSettle }: { message: string; onSettle: (result: boolean) => void }) {
  const dialogRef = useRef<HTMLDivElement>(null)
  // 취소 버튼(안전한 기본값)으로 포커스, 닫힐 때 원래 요소로 복원, Tab 순환
  const trapTab = useFocusTrap(dialogRef, '.confirm-cancel')

  // Esc = 취소. 캡처 단계에서 잡아 뒤에 있는 모달(CardModal 등)의 Esc 핸들러로 새지 않게 한다
  useEffect(() => {
    function onKeyDown(e: globalThis.KeyboardEvent) {
      if (e.key === 'Escape' && !e.isComposing) {
        e.stopPropagation()
        onSettle(false)
      }
    }
    document.addEventListener('keydown', onKeyDown, true)
    return () => document.removeEventListener('keydown', onKeyDown, true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div
      className="modal-backdrop confirm-backdrop"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onSettle(false)
      }}
    >
      <div className="confirm-dialog" role="alertdialog" aria-modal="true" ref={dialogRef} onKeyDown={trapTab}>
        <p className="confirm-message">{message}</p>
        <div className="confirm-actions">
          <button className="btn btn-subtle confirm-cancel" onClick={() => onSettle(false)}>
            취소
          </button>
          <button className="btn btn-danger-solid" onClick={() => onSettle(true)}>
            삭제
          </button>
        </div>
      </div>
    </div>
  )
}

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<Pending | null>(null)

  const confirm = useCallback(
    (options: ConfirmOptions) => new Promise<boolean>((resolve) => setPending({ options, resolve })),
    [],
  )

  function settle(result: boolean) {
    pending?.resolve(result)
    setPending(null)
  }

  return (
    <ConfirmContext.Provider value={{ confirm }}>
      {children}
      {pending && <ConfirmDialogView message={pending.options.message} onSettle={settle} />}
    </ConfirmContext.Provider>
  )
}

export function useConfirm(): ConfirmContextValue {
  const ctx = useContext(ConfirmContext)
  if (!ctx) throw new Error('useConfirm must be used within ConfirmProvider')
  return ctx
}
