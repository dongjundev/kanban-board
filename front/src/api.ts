import { apiFetch } from './http'
import type { Workspace } from './types'
import { isValidWorkspace } from './storage'

/**
 * Spring Boot 백엔드와의 통신 계층.
 * Vite 개발 서버가 /api를 localhost:8080으로 프록시한다 (vite.config.ts).
 * 백엔드가 응답하지 않으면 'offline'을 반환하고, 앱은 localStorage 모드로 동작한다.
 */

export interface RemoteWorkspace {
  version: number
  workspace: Workspace
}

export type FetchResult = RemoteWorkspace | 'empty' | 'offline'

export async function fetchRemoteWorkspace(): Promise<FetchResult> {
  try {
    const res = await apiFetch('/api/workspace', { headers: { Accept: 'application/json' } })
    if (res.status === 404) return 'empty'
    if (!res.ok) return 'offline'
    const data: unknown = await res.json()
    if (
      typeof data === 'object' &&
      data !== null &&
      typeof (data as { version?: unknown }).version === 'number' &&
      isValidWorkspace((data as { workspace?: unknown }).workspace)
    ) {
      return { version: (data as { version: number }).version, workspace: (data as { workspace: Workspace }).workspace }
    }
    // 서버 응답이 검증을 통과하지 못하면 로컬 데이터를 지키기 위해 빈 서버처럼 취급하지 않는다.
    // 다만 이 경우 앱은 '백엔드 없음'과 똑같이 조용히 localStorage 모드로 동작하므로,
    // 사용자는 동기화되는 줄 알지만 실제로는 아니다 — 최소한 진단은 가능하도록 남긴다.
    console.warn('[kanban] 서버 워크스페이스가 검증을 통과하지 못해 localStorage 모드로 동작합니다')
    return 'offline'
  } catch {
    return 'offline'
  }
}

/** 폴링용 — 버전 번호만 조회. 실패 시 null. */
export async function fetchRemoteVersion(): Promise<number | null> {
  try {
    const res = await apiFetch('/api/workspace/version', { headers: { Accept: 'application/json' } })
    if (!res.ok) return null
    const data: unknown = await res.json()
    const version = (data as { version?: unknown })?.version
    return typeof version === 'number' ? version : null
  } catch {
    return null
  }
}

export type SaveResult = { version: number } | 'conflict' | null

/**
 * 저장 성공 시 새 버전, 선행조건(baseVersion) 불일치면 'conflict', 실패면 null.
 * baseVersion을 보내면 서버가 그 버전일 때만 저장 — stale 클라이언트가
 * 다른 클라이언트의 확정 저장분을 덮어쓰는 것을 막는다.
 * keepalive는 탭 닫힘 직전 플러시용 (본문 64KiB 한도 주의 — 호출부에서 판단).
 */
export async function saveRemoteWorkspace(
  workspace: Workspace,
  baseVersion: number,
  keepalive = false,
): Promise<SaveResult> {
  try {
    const res = await apiFetch('/api/workspace', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workspace, baseVersion }),
      keepalive,
    })
    if (res.status === 409) return 'conflict'
    if (!res.ok) return null
    const data: unknown = await res.json()
    const version = (data as { version?: unknown })?.version
    return typeof version === 'number' ? { version } : null
  } catch {
    return null
  }
}
