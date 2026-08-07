/**
 * mermaid 차트 백엔드 통신 계층. 목록 응답에 code까지 담겨 오므로
 * 차트를 불러올 때 별도 조회 왕복이 없다.
 */

import { apiFetch } from './http'

export interface DiagramDto {
  id: number
  title: string
  code: string
  updatedAt: string
}

export async function listDiagrams(): Promise<DiagramDto[]> {
  const res = await apiFetch('/api/diagrams', { headers: { Accept: 'application/json' } })
  if (!res.ok) throw new Error('차트 목록을 불러오지 못했습니다')
  return res.json()
}

export async function createDiagram(title: string, code: string): Promise<DiagramDto> {
  const res = await apiFetch('/api/diagrams', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title, code }),
  })
  if (!res.ok) throw new Error('차트 저장에 실패했습니다')
  return res.json()
}

export async function updateDiagram(id: number, title: string, code: string): Promise<DiagramDto> {
  const res = await apiFetch(`/api/diagrams/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title, code }),
  })
  if (!res.ok) throw new Error('차트 수정에 실패했습니다')
  return res.json()
}

export async function deleteDiagram(id: number): Promise<void> {
  const res = await apiFetch(`/api/diagrams/${id}`, { method: 'DELETE' })
  if (!res.ok) throw new Error('차트 삭제에 실패했습니다')
}
