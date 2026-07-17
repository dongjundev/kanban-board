import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Undo2, X } from 'lucide-react'

interface ToastState {
  id: number
  message: string
  onUndo?: () => void
}

interface ToastContextValue {
  /** 토스트 표시. onUndo를 주면 '실행 취소' 버튼이 붙는다. 새 토스트는 이전 것을 대체. */
  showToast: (message: string, onUndo?: () => void) => void
}

const ToastContext = createContext<ToastContextValue | null>(null)

const TOAST_DURATION_MS = 7000

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<ToastState | null>(null)
  const nextId = useRef(0)

  const showToast = useCallback((message: string, onUndo?: () => void) => {
    nextId.current += 1
    setToast({ id: nextId.current, message, onUndo })
  }, [])

  useEffect(() => {
    if (!toast) return
    const timer = setTimeout(() => setToast(null), TOAST_DURATION_MS)
    return () => clearTimeout(timer)
  }, [toast])

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      {toast && (
        <div className="toast" role="status" aria-live="polite">
          <span className="toast-message">{toast.message}</span>
          {toast.onUndo && (
            <button
              className="btn btn-sm toast-undo"
              onClick={() => {
                toast.onUndo?.()
                setToast(null)
              }}
            >
              <Undo2 size={14} />
              실행 취소
            </button>
          )}
          <button className="btn btn-icon btn-sm" aria-label="알림 닫기" onClick={() => setToast(null)}>
            <X size={14} />
          </button>
        </div>
      )}
    </ToastContext.Provider>
  )
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used within ToastProvider')
  return ctx
}
