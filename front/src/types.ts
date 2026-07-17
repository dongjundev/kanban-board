export interface Label {
  id: string
  name: string
  color: string
}

export interface Card {
  id: string
  title: string
  description: string
  labelIds: string[]
  assignee: string
  dueDate: string | null // 'YYYY-MM-DD'
  createdAt: string // ISO datetime
}

export interface Column {
  id: string
  title: string
  cardIds: string[]
}

export interface BoardState {
  boardTitle: string
  columns: Record<string, Column>
  columnOrder: string[]
  cards: Record<string, Card>
  labels: Record<string, Label>
}

export interface Workspace {
  boards: Record<string, BoardState>
  boardOrder: string[]
  activeBoardId: string
}

export interface Filters {
  query: string
  labelIds: string[]
  assignees: string[]
}

export const EMPTY_FILTERS: Filters = { query: '', labelIds: [], assignees: [] }

/** Atlassian 계열 라벨 색상 팔레트 */
export const LABEL_COLORS = [
  '#4BCE97', // green
  '#F5CD47', // yellow
  '#FEA362', // orange
  '#F87168', // red
  '#9F8FEF', // purple
  '#579DFF', // blue
  '#6CC3E0', // teal
  '#94C748', // lime
  '#E774BB', // magenta
  '#8590A2', // gray
] as const
