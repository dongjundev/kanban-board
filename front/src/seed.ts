import type { BoardState, Workspace } from './types'
import { uid } from './utils'

function daysFromNow(days: number): string {
  const d = new Date()
  d.setDate(d.getDate() + days)
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${mm}-${dd}`
}

/** 첫 방문 시 보여줄 샘플 보드 */
function createSeedState(): BoardState {
  const now = new Date().toISOString()
  return {
    boardTitle: '팀 칸반 보드',
    labels: {
      'label-feature': { id: 'label-feature', name: '기능', color: '#4BCE97' },
      'label-bug': { id: 'label-bug', name: '버그', color: '#F87168' },
      'label-design': { id: 'label-design', name: '디자인', color: '#9F8FEF' },
      'label-docs': { id: 'label-docs', name: '문서', color: '#579DFF' },
    },
    cards: {
      'card-1': {
        id: 'card-1',
        title: '로그인 화면 개선',
        description: '소셜 로그인 버튼 추가 및 에러 메시지 문구를 다듬습니다.',
        labelIds: ['label-feature', 'label-design'],
        assignee: '김동준',
        dueDate: daysFromNow(5),
        createdAt: now,
      },
      'card-2': {
        id: 'card-2',
        title: 'API 응답 지연 버그 수정',
        description: '목록 조회 API가 간헐적으로 3초 이상 걸리는 문제를 조사합니다.',
        labelIds: ['label-bug'],
        assignee: '이수민',
        dueDate: daysFromNow(1),
        createdAt: now,
      },
      'card-3': {
        id: 'card-3',
        title: '온보딩 가이드 문서 작성',
        description: '',
        labelIds: ['label-docs'],
        assignee: '김동준',
        dueDate: null,
        createdAt: now,
      },
      'card-4': {
        id: 'card-4',
        title: '대시보드 차트 컴포넌트 구현',
        description: '주간 처리량을 보여주는 막대 차트를 구현합니다.',
        labelIds: ['label-feature'],
        assignee: '박지훈',
        dueDate: daysFromNow(-2),
        createdAt: now,
      },
      'card-5': {
        id: 'card-5',
        title: '배포 파이프라인 정리',
        description: '스테이징 자동 배포 완료. 운영 배포 승인 단계 추가됨.',
        labelIds: [],
        assignee: '이수민',
        dueDate: null,
        createdAt: now,
      },
    },
    columns: {
      'col-todo': { id: 'col-todo', title: '할 일', cardIds: ['card-1', 'card-2'] },
      'col-doing': { id: 'col-doing', title: '진행 중', cardIds: ['card-3', 'card-4'] },
      'col-done': { id: 'col-done', title: '완료', cardIds: ['card-5'] },
    },
    columnOrder: ['col-todo', 'col-doing', 'col-done'],
  }
}

export function createSeedWorkspace(): Workspace {
  return {
    boards: { 'board-seed': createSeedState() },
    boardOrder: ['board-seed'],
    activeBoardId: 'board-seed',
  }
}

/** 새 보드 — 기본 3컬럼, 카드/라벨 없음 */
export function createEmptyBoard(title: string): BoardState {
  const colIds = [uid(), uid(), uid()]
  const titles = ['할 일', '진행 중', '완료']
  return {
    boardTitle: title.trim(),
    columns: Object.fromEntries(colIds.map((id, i) => [id, { id, title: titles[i], cardIds: [] }])),
    columnOrder: colIds,
    cards: {},
    labels: {},
  }
}
