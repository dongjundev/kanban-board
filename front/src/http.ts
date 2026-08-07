/**
 * API 호출 공통 래퍼.
 *
 * 세션이 끊긴 뒤(재배포·만료) 401을 그냥 실패로 흘리면, 앱은 "백엔드 없음"과
 * 구분하지 못해 조용히 localStorage 모드로 동작한다 — 사용자는 저장됐다고 믿지만
 * 서버에는 아무것도 올라가지 않고 다른 기기와도 어긋난다. 그래서 401을 만나면
 * 이벤트를 쏘아 AuthGate가 로그인 화면을 다시 띄우게 한다.
 *
 * 로그인 시도 자체(/api/auth/*)는 401이 정상 응답이므로 여기를 거치지 않는다.
 */
export const UNAUTHORIZED_EVENT = 'kanban:unauthorized'

export async function apiFetch(input: string, init?: RequestInit): Promise<Response> {
  const res = await fetch(input, init)
  if (res.status === 401) {
    window.dispatchEvent(new CustomEvent(UNAUTHORIZED_EVENT))
  }
  return res
}
