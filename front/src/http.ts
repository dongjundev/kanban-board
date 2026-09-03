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

/**
 * JSON 본문을 gzip으로 압축한 fetch 옵션을 만든다.
 *
 * 회사망 보안장비가 일정 크기를 넘는 요청 본문을 막는 환경에서 메모·차트 저장이 실패한다.
 * 텍스트는 gzip으로 70~90% 줄어 한도 아래로 내려갈 여지가 크다. 백엔드의 GzipRequestFilter가
 * Content-Encoding: gzip 헤더를 보고 되돌리므로 반드시 짝으로 존재해야 한다 — 필터가 빠지면
 * 저장이 전부 400이 된다. (응답 gzip과 달리 요청 본문은 브라우저·서버 어느 쪽도 자동으로
 * 압축·해제하지 않아 양쪽에 직접 코드가 필요하다.)
 *
 * CompressionStream이 없는 오래된 브라우저는 평문 JSON으로 폴백한다 — 서버는 헤더가 없으면 그대로 읽는다.
 */
export async function gzipJsonRequest(method: string, payload: unknown): Promise<RequestInit> {
  const json = JSON.stringify(payload)
  if (typeof CompressionStream === 'undefined') {
    return { method, headers: { 'Content-Type': 'application/json' }, body: json }
  }
  // 스트림을 fetch body로 직접 넘기지 않고 Blob으로 확정한다 — 스트리밍 요청 본문은 Safari가 지원하지 않는다
  const body = await new Response(new Blob([json]).stream().pipeThrough(new CompressionStream('gzip'))).blob()
  return { method, headers: { 'Content-Type': 'application/json', 'Content-Encoding': 'gzip' }, body }
}
