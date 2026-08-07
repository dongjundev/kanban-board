import { useEffect, useState } from 'react'
import { LogIn } from 'lucide-react'
import type { AuthState } from '../authApi'
import * as authApi from '../authApi'
import { UNAUTHORIZED_EVENT } from '../http'

interface AuthGateProps {
  /** onLogout은 로그인이 설정된 배포에서만 전달된다 — 아니면 로그아웃 버튼을 숨긴다. */
  children: (onLogout: (() => void) | null) => React.ReactNode
}

/**
 * 로그인 관문. 인증이 필요한데 로그인 전이면 앱(BoardProvider 포함)을 아예 마운트하지
 * 않는다 — 뒤에서 워크스페이스를 불러오거나 폴링하지 않게 하기 위한 것이다.
 * 인증이 꺼져 있거나 백엔드가 없으면 그대로 통과시켜 localStorage 단독 모드를 유지한다.
 */
export function AuthGate({ children }: AuthGateProps) {
  const [state, setState] = useState<AuthState | null>(null)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    authApi.fetchAuthState().then(setState)
  }, [])

  // 세션이 끊기면(재배포·만료) API가 401을 돌려준다. 그대로 두면 앱은 계속 떠 있고
  // 변경은 localStorage에만 쌓여 서버·다른 기기와 어긋난다 — 즉시 로그인 화면으로 돌린다.
  // 다시 로그인하면 BoardContext의 재조정이 미전송 변경을 서버로 밀어올린다.
  useEffect(() => {
    function onUnauthorized() {
      setState((prev) => (prev?.authenticated === false ? prev : { required: true, authenticated: false, username: '' }))
    }
    window.addEventListener(UNAUTHORIZED_EVENT, onUnauthorized)
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, onUnauthorized)
  }, [])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (busy || !username || !password) return
    setBusy(true)
    setError(null)
    try {
      await authApi.login(username, password)
      setPassword('')
      setState(await authApi.fetchAuthState())
    } catch (err) {
      setError(err instanceof Error ? err.message : '로그인에 실패했습니다')
    } finally {
      setBusy(false)
    }
  }

  async function handleLogout() {
    await authApi.logout()
    setState(await authApi.fetchAuthState())
  }

  // 상태 확인 전에는 로그인 화면을 깜빡이지 않도록 아무것도 그리지 않는다
  if (state === null) return null

  if (state.required && !state.authenticated) {
    return (
      <div className="login-page">
        <form className="login-card" onSubmit={handleSubmit}>
          <h1 className="login-title">칸반 보드</h1>
          <p className="login-subtitle">계속하려면 로그인하세요.</p>
          <label className="login-label">
            아이디
            <input
              className="login-input"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              autoFocus
            />
          </label>
          <label className="login-label">
            비밀번호
            <input
              className="login-input"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
            />
          </label>
          {error && <div className="login-error">{error}</div>}
          <button className="btn btn-primary login-submit" type="submit" disabled={busy || !username || !password}>
            <LogIn size={16} /> {busy ? '확인 중…' : '로그인'}
          </button>
        </form>
      </div>
    )
  }

  return <>{children(state.required ? handleLogout : null)}</>
}
