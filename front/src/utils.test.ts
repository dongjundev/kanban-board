import { describe, expect, it } from 'vitest'
import { dueStatus, formatDueDate, initials } from './utils'

describe('dueStatus', () => {
  // 시각과 무관하게 날짜 단위로 판정되는지 오후 시각으로 고정
  const now = new Date(2026, 6, 15, 14, 30) // 2026-07-15 14:30

  it('지난 날짜는 overdue', () => {
    expect(dueStatus('2026-07-14', now)).toBe('overdue')
    expect(dueStatus('2026-06-01', now)).toBe('overdue')
  })

  it('오늘~이틀 뒤는 soon (D+2 경계 포함)', () => {
    expect(dueStatus('2026-07-15', now)).toBe('soon')
    expect(dueStatus('2026-07-16', now)).toBe('soon')
    expect(dueStatus('2026-07-17', now)).toBe('soon')
  })

  it('사흘 뒤부터는 normal', () => {
    expect(dueStatus('2026-07-18', now)).toBe('normal')
    expect(dueStatus('2026-12-31', now)).toBe('normal')
  })

  it('월 경계를 넘어도 날짜 단위로 계산된다', () => {
    const endOfMonth = new Date(2026, 6, 31, 23, 0) // 7월 31일 23:00
    expect(dueStatus('2026-08-02', endOfMonth)).toBe('soon')
    expect(dueStatus('2026-08-03', endOfMonth)).toBe('normal')
  })
})

describe('formatDueDate', () => {
  const now = new Date(2026, 6, 15)

  it('올해 날짜는 월·일만 표시한다', () => {
    expect(formatDueDate('2026-07-20', now)).toBe('7월 20일')
  })

  it('다른 해 날짜는 연도를 함께 표시한다', () => {
    expect(formatDueDate('2025-11-30', now)).toBe('2025년 11월 30일')
    expect(formatDueDate('2027-01-05', now)).toBe('2027년 1월 5일')
  })
})

describe('initials', () => {
  it('한글 이름은 첫 글자', () => {
    expect(initials('김동준')).toBe('김')
  })

  it('영문 이름은 단어별 첫 글자 최대 2개', () => {
    expect(initials('John Doe')).toBe('JD')
    expect(initials('alice')).toBe('A')
  })

  it('빈 문자열은 ?', () => {
    expect(initials('  ')).toBe('?')
  })
})
