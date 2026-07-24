import type { Card, Label } from './types'

export function uid(): string {
  // crypto.randomUUID는 보안 컨텍스트(HTTPS·localhost)에만 존재 — HTTP+IP 배포 등
  // 비보안 컨텍스트에서는 undefined라 호출 시 크래시. getRandomValues는 어디서나 가능.
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    const bytes = crypto.getRandomValues(new Uint8Array(16))
    bytes[6] = (bytes[6] & 0x0f) | 0x40 // version 4
    bytes[8] = (bytes[8] & 0x3f) | 0x80 // variant 10
    const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
  }
  // 최후 폴백 (crypto 자체가 없는 극단적 환경)
  return `${Date.now().toString(16)}-${Math.random().toString(16).slice(2, 10)}`
}

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

/** 카드들에서 고유 담당자 이름을 모아 한국어 기준으로 정렬 */
export function collectAssignees(cards: Record<string, Card>): string[] {
  const names = new Set<string>()
  for (const card of Object.values(cards)) {
    if (card.assignee) names.add(card.assignee)
  }
  return [...names].sort((a, b) => a.localeCompare(b, 'ko'))
}

/** 카드에 지정된 라벨을 해석 (삭제된 라벨의 유령 참조는 걸러냄) */
export function labelsOf(card: Card, labels: Record<string, Label>): Label[] {
  return card.labelIds.map((id) => labels[id]).filter((label): label is Label => label !== undefined)
}

const AVATAR_COLORS = ['#0C66E4', '#1F845A', '#946F00', '#C9372C', '#5E4DB2', '#206A83', '#943D73', '#596773']

/** 이름에서 결정적으로 아바타 배경색을 고른다. */
export function avatarColor(name: string): string {
  let hash = 0
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) | 0
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length]
}

/** 이름의 이니셜 (한글은 첫 글자, 영문은 단어별 첫 글자 최대 2개) */
export function initials(name: string): string {
  const trimmed = name.trim()
  if (!trimmed) return '?'
  if (/[가-힣]/.test(trimmed[0])) return trimmed[0]
  return trimmed
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join('')
}

export type DueStatus = 'overdue' | 'soon' | 'normal'

/** 마감일 상태: 지남 / 임박(오늘~2일 내) / 보통 — 날짜 단위로 비교 */
export function dueStatus(dueDate: string, now: Date = new Date()): DueStatus {
  const [y, m, d] = dueDate.split('-').map(Number)
  const due = new Date(y, m - 1, d)
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const diffDays = Math.round((due.getTime() - today.getTime()) / 86_400_000)
  if (diffDays < 0) return 'overdue'
  if (diffDays <= 2) return 'soon'
  return 'normal'
}

/** 'YYYY-MM-DD' → 'M월 D일' (올해가 아니면 'YYYY년 M월 D일'로 연도 표기) */
export function formatDueDate(dueDate: string, now: Date = new Date()): string {
  const [y, m, d] = dueDate.split('-').map(Number)
  const base = `${m}월 ${d}일`
  return y === now.getFullYear() ? base : `${y}년 ${base}`
}
