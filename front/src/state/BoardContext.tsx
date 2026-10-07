import { createContext, useContext, useEffect, useReducer, useRef, useState } from 'react'
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
  /** 서버 동기화가 멈춰 있음 (저장 실패로 재시도 중이거나 서버에 닿지 않음) */
  syncFailing: boolean
}

const BoardContext = createContext<BoardContextValue | null>(null)

/** 서버 저장 디바운스 — 드래그/타이핑처럼 잦은 dispatch를 한 번의 PUT으로 묶는다 */
const SAVE_DEBOUNCE_MS = 400
/** 저장 실패 시 재시도 간격 */
const RETRY_DELAY_MS = 3000
/** 다른 클라이언트의 변경 감지 + 오프라인→서버 승격 감지 주기 */
const POLL_INTERVAL_MS = 4000
/** 폴링이 이만큼 연속 실패해야 동기화 장애로 표시 — 일시적 오류 한 번에 경고가 깜빡이지 않게 */
const POLL_FAILURE_THRESHOLD = 2
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
  // 서버 PUT 직렬화 체인 (flushRemote 주석 참조)
  const flushChain = useRef<Promise<void>>(Promise.resolve())
  // 서버 PUT(충돌 시 pull 포함)이 진행 중 — 그동안 받아온 원격 상태는 적용하지 않는다 (pullRemote 주석 참조)
  const flushing = useRef(false)
  // 비동기 콜백에서 최신 상태를 읽기 위한 ref
  const latest = useRef(workspace)
  latest.current = workspace
  // 직전 저장 effect가 본 상태 — 보드 선택만 바뀐 변경을 가려낸다 (저장 effect 주석 참조)
  const persisted = useRef(workspace)
  // 동기화 장애 표시. 실패를 콘솔에만 남기면 사용자는 동기화되는 줄 알고 계속 쓰는데, 그동안 이 기기의
  // 변경은 서버에 없고 다른 기기의 변경도 들어오지 않는다(재시도 중엔 폴링도 멈춘다)
  const [syncFailing, setSyncFailing] = useState(false)
  const pollFailures = useRef(0)

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

  /**
   * 폴링·탭 복귀·접속 시의 pull. 받아오는 사이 로컬 변경이 생겼거나 저장이 진행 중이면 적용하지 않는다.
   * 적용하면 화면은 원격 상태로 바뀌는데, 대기 중이던 로컬 스냅샷(원격 변경 이전 상태 기반)이 새
   * baseVersion을 달고 나가 원격 변경을 조용히 덮는다 — 그 뒤로는 버전이 같아 폴링이 다시 받아오지
   * 않으므로 화면은 서버와 어긋난 채로 남는다. 적용을 건너뛰면 로컬 변경의 PUT이 원래 baseVersion으로
   * 나가 409 → 충돌 처리(서버 상태 적용 + 알림)로 정식 수렴한다.
   * 반환값은 서버 문서를 받아왔는지(적용 여부와 무관) — 동기화 장애 판단용.
   */
  async function pullRemote(): Promise<boolean> {
    const base = lastVersion.current
    const remote = await fetchRemoteWorkspace()
    if (typeof remote !== 'object') return false
    // 받아오는 사이 버전이 움직였으면(저장 성공·다른 pull 적용) 이 응답은 낡았을 수 있다 — 다음 폴링이 판단
    if (dirty.current || flushing.current || lastVersion.current !== base) return true
    applyRemote(remote)
    return true
  }

  /**
   * 폴링 결과로 동기화 장애 표시를 갱신한다. 저장 실패 표시는 저장 경로가 관리하므로, 저장이
   * 진행·대기 중일 때는 폴링 성공으로 지우지 않는다(PUT만 막히고 GET은 통하는 네트워크에서는 폴링이 성공한다).
   */
  function reportPoll(ok: boolean) {
    if (!ok) {
      pollFailures.current += 1
      if (pollFailures.current >= POLL_FAILURE_THRESHOLD) setSyncFailing(true)
      return
    }
    pollFailures.current = 0
    if (!flushing.current && !dirty.current) setSyncFailing(false)
  }

  /**
   * 서버 저장은 반드시 직렬화한다. PUT이 느린 동안(배포 VM 실측 0.1~1.4초) 다음
   * 디바운스가 만료되면 두 PUT이 같은 baseVersion으로 동시에 나가고, 뒤엣것이
   * 자기 자신과 409로 충돌한다 — 방금 한 변경이 "다른 기기 충돌"로 둔갑해
   * 되돌려진다(혼자 써도 유실). 줄을 세우면 앞 PUT이 갱신한 버전을 보고 이어간다.
   */
  function flushRemote(keepalive = false): Promise<void> {
    const run = flushChain.current.then(() => doFlushRemote(keepalive))
    flushChain.current = run.catch(() => {}) // 실패해도 체인이 끊기지 않게
    return run
  }

  async function doFlushRemote(keepalive: boolean) {
    const pending = dirty.current
    if (!pending) return
    saveWorkspace(pending) // 디바운스로 미뤄둔 localStorage 미러 최신화
    if (!serverMode.current) {
      dirty.current = null
      return
    }
    dirty.current = null
    flushing.current = true
    try {
      const result = await saveRemoteWorkspace(pending, lastVersion.current, keepalive)
      setSyncFailing(result === null) // 409도 서버가 응답한 것 — 연결은 정상
      if (result === 'conflict') {
        // 다른 클라이언트가 먼저 저장 — 서버 상태를 받아들이고 사용자에게 알림
        const remote = await fetchRemoteWorkspace()
        if (typeof remote === 'object') {
          // 기다리는 사이 쌓인 편집도 충돌 이전 상태 위의 것이라 함께 버린다 — 남겨두면 새
          // baseVersion을 달고 나가 방금 받은 원격 변경을 덮는다(화면과 서버가 어긋남)
          if (saveTimer.current) {
            clearTimeout(saveTimer.current)
            saveTimer.current = null
          }
          dirty.current = null
          applyRemote(remote, true)
        }
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
    } finally {
      flushing.current = false
    }
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
        // 보드 선택(activeBoardId)은 서버로 보내지 않는 기기별 상태라 비교에서 뺀다 — 넣으면 다른 보드를
        // 보던 기기가 새로고침할 때마다 내용이 같은데도 미전송 변경으로 오판해 저장(버전 증가)한다
        const contentOf = (ws: Workspace) => JSON.stringify([ws.boards, ws.boardOrder])
        if (contentOf(latest.current) !== contentOf(remote.workspace)) {
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

    await pullRemote()
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
    const prev = persisted.current
    persisted.current = workspace
    const skip = skipNextPersist.current
    skipNextPersist.current = null
    if (skip === 'all') return
    if (skip === 'remote') {
      saveWorkspace(workspace) // 서버발 적용 — 미러만 갱신하고 되돌려 보내지 않음
      return
    }
    // 보드 선택(activeBoardId)만 바뀌었으면 서버로 보내지 않는다 — 기기마다 다른 화면 상태라(받는 쪽은
    // REPLACE_WORKSPACE가 자기 선택을 유지) 보내 봐야 버전만 올라, 다른 기기들이 문서 전체를 다시 받고
    // 마침 편집 중이던 기기는 내용 충돌이 없는데도 409로 편집을 잃는다. 미러에는 남겨 새로고침해도 유지.
    if (workspace !== prev && workspace.boards === prev.boards && workspace.boardOrder === prev.boardOrder) {
      if (dirty.current) dirty.current = workspace // 대기 중인 저장이 미러에 최신 선택을 쓰도록
      else saveWorkspace(workspace)
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
      if (version === null || version === lastVersion.current) {
        reportPoll(version !== null)
        return
      }
      if (dirty.current) return
      reportPoll(await pullRemote())
    }, POLL_INTERVAL_MS)
    return () => clearInterval(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 탭이 가려질 때(전환/최소화) 미리 플러시 — 페이지가 살아있어 일반 fetch 가능
  useEffect(() => {
    function onVisibilityChange() {
      if (document.hidden) {
        if (!dirty.current) return
        if (saveTimer.current) {
          clearTimeout(saveTimer.current)
          saveTimer.current = null
        }
        void flushRemote()
        return
      }
      // 다시 보일 때 즉시 한 번 확인 — 폴링은 숨김 동안 멈춰 있으므로(배터리),
      // 이게 없으면 다른 기기의 변경이 최대 폴링 주기만큼 늦게 보인다.
      if (!serverMode.current || dirty.current) return
      void (async () => {
        const version = await fetchRemoteVersion()
        if (version === null || version === lastVersion.current || dirty.current) return
        await pullRemote()
      })()
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

  return <BoardContext.Provider value={{ workspace, state, dispatch, syncFailing }}>{children}</BoardContext.Provider>
}

export function useBoard(): BoardContextValue {
  const ctx = useContext(BoardContext)
  if (!ctx) throw new Error('useBoard must be used within BoardProvider')
  return ctx
}
