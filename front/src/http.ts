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

/**
 * 응답이 오지 않을 때 무한정 기다리지 않도록 하는 기본 제한.
 * 없으면 연결이 멎었을 때 버튼이 계속 비활성인 채 아무 안내도 없어,
 * "저장이 오래 걸린다"로 보인다(OS의 TCP 타임아웃까지 수 분이 걸릴 수 있다).
 *
 * 넉넉히 잡은 이유: 너무 짧으면 느린 회선에서 서버는 이미 저장했는데 클라이언트만
 * 실패로 보고, 사용자가 다시 눌러 같은 내용이 두 벌 저장될 수 있다.
 */
const DEFAULT_TIMEOUT_MS = 20000

export async function apiFetch(input: string, init?: RequestInit, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<Response> {
  let res: Response
  try {
    res = await fetch(input, {
      ...init,
      // 파일 전송처럼 오래 걸리는 요청은 호출부가 0을 넘겨 제한을 끈다
      signal: timeoutMs > 0 ? AbortSignal.timeout(timeoutMs) : init?.signal,
    })
  } catch (e) {
    if (e instanceof DOMException && e.name === 'TimeoutError') {
      throw new Error('서버 응답이 없습니다. 네트워크 상태를 확인하고 다시 시도하세요')
    }
    throw e
  }
  if (res.status === 401) {
    window.dispatchEvent(new CustomEvent(UNAUTHORIZED_EVENT))
  }
  return res
}

/** 파일 업로드·다운로드처럼 크기에 따라 오래 걸릴 수 있는 요청 — 시간 제한 없음. */
export function apiFetchNoTimeout(input: string, init?: RequestInit): Promise<Response> {
  return apiFetch(input, init, 0)
}
