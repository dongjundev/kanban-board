import { createContext, useContext, useEffect, useReducer, useRef } from 'react'
import type { Dispatch, ReactNode } from 'react'
import type { BoardState, Workspace } from '../types'
import { workspaceReducer } from './workspaceReducer'
import type { WorkspaceAction } from './workspaceReducer'
import { WORKSPACE_KEY, loadBaseVersion, loadWorkspace, parseWorkspace, saveBaseVersion, saveWorkspace } from '../storage'
import { fetchRemoteVersion, fetchRemoteWorkspace, saveRemoteWorkspace } from '../api'
import type { RemoteWorkspace } from '../api'
import { createSeedWorkspace } from '../seed'

interface BoardContextValue {
  workspace: Workspace
  /** 활성 보드 상태 — 기존 컴포넌트 호환용 이름 */
  state: BoardState
  dispatch: Dispatch<WorkspaceAction>
}

const BoardContext = createContext<BoardContextValue | null>(null)

/** 서버 저장 디바운스 — 드래그/타이핑처럼 잦은 dispatch를 한 번의 PUT으로 묶는다 */
const SAVE_DEBOUNCE_MS = 400
/** 저장 실패 시 재시도 간격 */
const RETRY_DELAY_MS = 3000
/** 다른 클라이언트의 변경 감지 + 오프라인→서버 승격 감지 주기 */
const POLL_INTERVAL_MS = 4000
/** fetch keepalive의 브라우저 본문 한도(64KiB)보다 여유 있게 */
const KEEPALIVE_LIMIT_BYTES = 60_000

/** 저장 스킵 모드: 'all'=미러+서버 모두 스킵(탭 간 에코 방지), 'remote'=서버만 스킵(서버발 적용) */
type SkipMode = 'all' | 'remote' | null

export function BoardProvider({ children }: { children: ReactNode }) {
  const [workspace, dispatch] = useReducer(workspaceReducer, undefined, () => loadWorkspace() ?? createSeedWorkspace())

  const skipNextPersist = useRef<SkipMode>(null)
  // 백엔드 연결 여부 — 연결 전/실패 시 localStorage 단독 모드 (폴링이 주기적으로 재감지)
  const serverMode = useRef(false)
  // 서버가 알고 있는 최신 버전 (폴링 비교·저장 선행조건)
  const lastVersion = useRef(0)
  // 디바운스/재시도 대기 중인 미저장 상태
  const dirty = useRef<Workspace | null>(null)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // 비동기 콜백에서 최신 상태를 읽기 위한 ref
  const latest = useRef(workspace)
  latest.current = workspace

  function scheduleFlush(delay: number) {
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => {
      saveTimer.current = null
      void flushRemote()
    }, delay)
  }

  function applyRemote(remote: RemoteWorkspace, notifyConflict = false) {
    lastVersion.current = remote.version
    saveBaseVersion(remote.version)
    skipNextPersist.current = 'remote'
    dispatch({ type: 'REPLACE_WORKSPACE', workspace: remote.workspace })
    if (notifyConflict) window.dispatchEvent(new CustomEvent('kanban:sync-conflict'))
  }

  async function pullRemote(notifyConflict: boolean) {
    const remote = await fetchRemoteWorkspace()
    if (typeof remote === 'object') applyRemote(remote, notifyConflict)
  }

  async function flushRemote(keepalive = false) {
    const pending = dirty.current
    if (!pending) return
    saveWorkspace(pending) // 디바운스로 미뤄둔 localStorage 미러 최신화
    if (!serverMode.current) {
      dirty.current = null
      return
    }
    dirty.current = null
    const result = await saveRemoteWorkspace(pending, lastVersion.current, keepalive)
    if (result === 'conflict') {
      // 다른 클라이언트가 먼저 저장 — 서버 상태를 받아들이고 사용자에게 알림
      await pullRemote(true)
      return
    }
    if (result !== null) {
      lastVersion.current = result.version
      saveBaseVersion(result.version)
      return
    }
    // 실패 — 그 사이 더 새로운 변경이 없으면 복구해 재시도 (조용한 유실 방지)
    if (!dirty.current) {
      dirty.current = pending
      scheduleFlush(RETRY_DELAY_MS)
    }
    console.warn('[kanban] 서버 저장 실패 — 잠시 후 재시도합니다 (localStorage에는 저장됨)')
  }

  /**
   * 백엔드 접속 시도. 감지는 /version 엔드포인트(항상 200 JSON)로 해서
   * 정적 호스팅의 404/SPA 폴백을 '빈 서버'로 오판하지 않는다.
   */
  async function connectToServer(): Promise<void> {
    const version = await fetchRemoteVersion()
    if (version === null) return // 백엔드 없음 — localStorage 모드 유지
    const firstConnect = !serverMode.current
    serverMode.current = true

    // 마운트 save-effect가 잡아둔 초기 상태 dirty를 정리 — 서버 채택 전의 로컬 상태가
    // 뒤늦은 플러시로 서버를 덮지 않도록. 실제 미전송 변경은 아래 마이그레이션/재조정
    // 경로가 latest.current 기준으로 판단해 처리한다.
    if (saveTimer.current) {
      clearTimeout(saveTimer.current)
      saveTimer.current = null
    }
    dirty.current = null

    if (version === 0) {
      // 서버가 비어 있음 → 로컬 데이터(시드/기존) 마이그레이션
      dirty.current = latest.current
      await flushRemote()
      console.info('[kanban] 로컬 데이터를 서버로 마이그레이션했습니다')
      return
    }

    // 재조정: 로컬 미러가 같은 서버 버전 기반인데 내용이 다르면 미전송 변경 → 서버로 반영.
    // (탭 강제 종료·keepalive 한도 초과 등으로 마지막 저장이 유실된 경우의 복구 경로)
    if (loadBaseVersion() === version) {
      const remote = await fetchRemoteWorkspace()
      if (typeof remote === 'object') {
        if (JSON.stringify(latest.current) !== JSON.stringify(remote.workspace)) {
          lastVersion.current = version
          dirty.current = latest.current
          await flushRemote()
          console.info('[kanban] 미전송 로컬 변경을 서버로 반영했습니다')
        } else {
          applyRemote(remote)
        }
        return
      }
      return
    }

    await pullRemote(false)
    if (firstConnect) console.info('[kanban] 서버 모드로 동작합니다')
  }

  // 초기 접속 시도
  useEffect(() => {
    void connectToServer().then(() => {
      if (!serverMode.current) console.info('[kanban] 백엔드 미감지 — localStorage 모드로 동작합니다')
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 상태 변경 → localStorage 미러 + 서버 디바운스 저장.
  // 미러 직렬화(전체 워크스페이스 stringify)는 카드 수에 비례하므로 드래그처럼 잦은
  // dispatch에서는 leading(첫 변경 즉시) + trailing(플러시 시) 두 번으로 묶는다.
  useEffect(() => {
    const skip = skipNextPersist.current
    skipNextPersist.current = null
    if (skip === 'all') return
    if (skip === 'remote') {
      saveWorkspace(workspace) // 서버발 적용 — 미러만 갱신하고 되돌려 보내지 않음
      return
    }
    if (!dirty.current) saveWorkspace(workspace) // 연속 변경의 첫 건은 즉시 기록 (내구성·탭 간 즉시 동기화)
    dirty.current = workspace
    scheduleFlush(SAVE_DEBOUNCE_MS)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspace])

  // 폴링: 다른 클라이언트의 변경 반영 + 오프라인이었다면 백엔드 재감지(승격)
  useEffect(() => {
    const id = setInterval(async () => {
      if (document.hidden) return
      if (!serverMode.current) {
        await connectToServer()
        return
      }
      if (dirty.current) return // 로컬 미저장 변경 우선 — 다음 턴에
      const version = await fetchRemoteVersion()
      if (version === null || version === lastVersion.current) return
      if (dirty.current) return
      await pullRemote(false)
    }, POLL_INTERVAL_MS)
    return () => clearInterval(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 탭이 가려질 때(전환/최소화) 미리 플러시 — 페이지가 살아있어 일반 fetch 가능
  useEffect(() => {
    function onVisibilityChange() {
      if (document.hidden && dirty.current) {
        if (saveTimer.current) {
          clearTimeout(saveTimer.current)
          saveTimer.current = null
        }
        void flushRemote()
      }
    }
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => document.removeEventListener('visibilitychange', onVisibilityChange)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 탭을 닫을 때 최후 플러시. keepalive는 본문 64KiB 한도가 있어 초과 시 일반 fetch로 시도(최선 노력)
  // — 그래도 실패하면 미러+기반버전이 남아 다음 접속의 재조정이 복구한다.
  useEffect(() => {
    function onPageHide() {
      if (saveTimer.current) {
        clearTimeout(saveTimer.current)
        saveTimer.current = null
      }
      const pending = dirty.current
      if (!pending) return
      const size = new Blob([JSON.stringify(pending)]).size
      void flushRemote(size <= KEEPALIVE_LIMIT_BYTES)
    }
    window.addEventListener('pagehide', onPageHide)
    return () => window.removeEventListener('pagehide', onPageHide)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 같은 브라우저의 다른 탭에서 저장한 변경을 즉시 반영 (서버 폴링보다 빠른 경로)
  useEffect(() => {
    function onStorage(e: StorageEvent) {
      if (e.key !== WORKSPACE_KEY || e.newValue === null) return
      const next = parseWorkspace(e.newValue)
      if (next) {
        skipNextPersist.current = 'all'
        dispatch({ type: 'REPLACE_WORKSPACE', workspace: next })
      }
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  // 검증/리듀서 가드로 항상 존재하지만, 만약을 대비해 첫 보드로 폴백
  const state = workspace.boards[workspace.activeBoardId] ?? workspace.boards[workspace.boardOrder[0]]

  return <BoardContext.Provider value={{ workspace, state, dispatch }}>{children}</BoardContext.Provider>
}

export function useBoard(): BoardContextValue {
  const ctx = useContext(BoardContext)
  if (!ctx) throw new Error('useBoard must be used within BoardProvider')
  return ctx
}
