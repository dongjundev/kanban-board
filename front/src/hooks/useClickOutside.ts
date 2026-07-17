import { useEffect } from 'react'
import type { RefObject } from 'react'

/**
 * ref 바깥을 클릭하면 handler 호출 (active가 true일 때만 리스너 부착).
 * - 캡처 단계에서 감지 — 드래그 방지용 stopPropagation(버블 차단)이 있어도 정상 동작.
 * - confirm 다이얼로그(최상위 레이어) 안에서의 클릭은 '바깥'으로 치지 않는다 —
 *   확인/취소 버튼 클릭이 밑에 열린 팝오버를 닫아버리는 것을 방지.
 * - event: 'pointerdown'(기본, 즉시 닫힘) 또는 'click'(누르기 완료 후 닫힘 —
 *   composer처럼 pointerdown 시점의 레이아웃 변형이 드래그 측정을 깨는 경우에 사용).
 */
export function useClickOutside(
  ref: RefObject<HTMLElement | null>,
  active: boolean,
  handler: () => void,
  event: 'pointerdown' | 'click' = 'pointerdown',
) {
  useEffect(() => {
    if (!active) return
    function onEvent(e: Event) {
      const target = e.target as Node
      if (target instanceof Element && target.closest('.confirm-backdrop')) return
      if (ref.current && !ref.current.contains(target)) handler()
    }
    document.addEventListener(event, onEvent, true)
    return () => document.removeEventListener(event, onEvent, true)
  })
}
