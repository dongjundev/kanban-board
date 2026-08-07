/**
 * 로그인 통신 계층. 세션 쿠키(HttpOnly)로 상태를 유지하므로 토큰을 다루지 않는다 —
 * JS에서 읽을 수 없어 XSS로 탈취되지 않는다.
 */

export interface AuthState {
  /** 서버에 로그인이 설정되어 있는가 (환경변수 미설정이면 false) */
  required: boolean
  authenticated: boolean
  username: string
}

/** 백엔드가 없는 배포(정적 호스팅)에서는 조회 자체가 실패한다 — 그때는 인증 없음으로 본다. */
export const NO_BACKEND: AuthState = { required: false, authenticated: true, username: '' }

export async function fetchAuthState(): Promise<AuthState> {
  try {
    // 이 응답을 기다리는 동안 화면이 비므로 시간을 제한한다 — 서버가 응답 없이
    // 물려 있으면 백엔드 없는 상태와 구분되지 않아 앱이 영원히 빈 화면이 된다.
    const res = await fetch('/api/auth/me', {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(5000),
    })
    if (!res.ok) return NO_BACKEND
    const data = (await res.json()) as Partial<AuthState>
    if (typeof data?.required !== 'boolean') return NO_BACKEND
    return {
      required: data.required,
      authenticated: data.authenticated === true,
      username: typeof data.username === 'string' ? data.username : '',
    }
  } catch {
    // 네트워크 실패 = 백엔드 없음
    return NO_BACKEND
  }
}

export async function login(username: string, password: string): Promise<void> {
  const res = await fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  })
  if (!res.ok) {
    const message = await res
      .json()
      .then((d: { message?: string }) => d?.message)
      .catch(() => undefined)
    throw new Error(message ?? '로그인에 실패했습니다')
  }
}

export async function logout(): Promise<void> {
  await fetch('/api/auth/logout', { method: 'POST' })
}
