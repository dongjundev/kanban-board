import { describe, expect, it } from 'vitest'
import type { Card, Label } from './types'
import { EMPTY_FILTERS } from './types'
import { cardMatchesFilters } from './filtering'

const labels: Record<string, Label> = {
  l1: { id: 'l1', name: '버그', color: '#F87168' },
  l2: { id: 'l2', name: '디자인', color: '#9F8FEF' },
}

const card: Card = {
  id: 'c1',
  title: '로그인 화면 개선',
  description: '에러 메시지 문구 다듬기',
  labelIds: ['l1'],
  assignee: '김동준',
  dueDate: null,
  createdAt: '2026-01-01T00:00:00.000Z',
}

describe('cardMatchesFilters 검색 범위', () => {
  it('제목과 설명을 매칭한다', () => {
    expect(cardMatchesFilters(card, { ...EMPTY_FILTERS, query: '로그인' }, labels)).toBe(true)
    expect(cardMatchesFilters(card, { ...EMPTY_FILTERS, query: '에러 메시지' }, labels)).toBe(true)
  })

  it('담당자 이름을 매칭한다', () => {
    expect(cardMatchesFilters(card, { ...EMPTY_FILTERS, query: '김동준' }, labels)).toBe(true)
    expect(cardMatchesFilters(card, { ...EMPTY_FILTERS, query: '이수민' }, labels)).toBe(false)
  })

  it('지정된 라벨 이름을 매칭한다 (미지정 라벨은 제외)', () => {
    expect(cardMatchesFilters(card, { ...EMPTY_FILTERS, query: '버그' }, labels)).toBe(true)
    expect(cardMatchesFilters(card, { ...EMPTY_FILTERS, query: '디자인' }, labels)).toBe(false)
  })

  it('대소문자를 구분하지 않는다', () => {
    const enCard = { ...card, title: 'Fix API Bug' }
    expect(cardMatchesFilters(enCard, { ...EMPTY_FILTERS, query: 'api' }, labels)).toBe(true)
  })
})
