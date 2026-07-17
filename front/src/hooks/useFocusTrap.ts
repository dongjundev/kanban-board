import { useEffect } from 'react'
import type { KeyboardEvent, RefObject } from 'react'

const FOCUSABLE_SELECTOR = 'button, input, textarea, [tabindex]:not([tabindex="-1"])'

/**
 * 다이얼로그 포커스 관리 공용 훅 (CardModal·ConfirmDialog에서 사용):
 * - 마운트 시 initialFocus 셀렉터(없으면 컨테이너)로 포커스를 옮기고, 언마운트 시 이전 포커스 복원
 * - 반환된 핸들러를 onKeyDown에 걸면 Tab이 컨테이너 밖으로 나가지 않고 순환
 *
 * 다이얼로그가 열릴 때 마운트되는 컴포넌트 안에서 호출해야 한다 (마운트 = 열림).
 */
export function useFocusTrap(ref: RefObject<HTMLElement | null>, initialFocus?: string) {
  useEffect(() => {
    const previouslyFocused = document.activeElement
    const target = initialFocus ? ref.current?.querySelector<HTMLElement>(initialFocus) : null
    ;(target ?? ref.current)?.focus()
    return () => {
      if (previouslyFocused instanceof HTMLElement) previouslyFocused.focus()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return function trapTab(e: KeyboardEvent<HTMLElement>) {
    if (e.key !== 'Tab' || !ref.current) return
    const focusables = ref.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)
    if (focusables.length === 0) return
    const first = focusables[0]
    const last = focusables[focusables.length - 1]
    if (e.shiftKey && (document.activeElement === first || document.activeElement === ref.current)) {
      e.preventDefault()
      last.focus()
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault()
      first.focus()
    }
  }
}
