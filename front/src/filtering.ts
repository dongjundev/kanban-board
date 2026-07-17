import type { Card, Filters, Label } from './types'

export function isFilterActive(filters: Filters): boolean {
  return filters.query.trim() !== '' || filters.labelIds.length > 0 || filters.assignees.length > 0
}

export function cardMatchesFilters(card: Card, filters: Filters, labels: Record<string, Label>): boolean {
  const query = filters.query.trim().toLowerCase()
  if (query) {
    // 제목·설명 외에 담당자 이름과 지정된 라벨 이름도 검색 대상 (Trello 필터 검색 방식)
    const labelNames = card.labelIds.map((id) => labels[id]?.name ?? '').join('\n')
    const haystack = `${card.title}\n${card.description}\n${card.assignee}\n${labelNames}`.toLowerCase()
    if (!haystack.includes(query)) return false
  }
  if (filters.labelIds.length > 0 && !filters.labelIds.some((id) => card.labelIds.includes(id))) {
    return false
  }
  if (filters.assignees.length > 0 && !filters.assignees.includes(card.assignee)) {
    return false
  }
  return true
}
