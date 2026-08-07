/**
 * 메모·파일 백엔드 통신 계층. 서버 저장이 전제이므로(칸반과 달리 로컬 폴백 없음)
 * 실패 시 에러를 던지고, 호출부(MemoPage)가 사용자에게 메시지를 표시한다.
 */

import { apiFetch } from './http'

export interface NoteDto {
  id: number
  content: string
  createdAt: string
}

export interface StoredFileDto {
  id: number
  filename: string
  contentType: string
  size: number
  createdAt: string
}

export async function listNotes(): Promise<NoteDto[]> {
  const res = await apiFetch('/api/notes', { headers: { Accept: 'application/json' } })
  if (!res.ok) throw new Error('메모 목록을 불러오지 못했습니다')
  return res.json()
}

export async function createNote(content: string): Promise<NoteDto> {
  const res = await apiFetch('/api/notes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content }),
  })
  if (!res.ok) throw new Error('메모 저장에 실패했습니다')
  return res.json()
}

export async function deleteNote(id: number): Promise<void> {
  const res = await apiFetch(`/api/notes/${id}`, { method: 'DELETE' })
  if (!res.ok) throw new Error('메모 삭제에 실패했습니다')
}

export async function listFiles(): Promise<StoredFileDto[]> {
  const res = await apiFetch('/api/files', { headers: { Accept: 'application/json' } })
  if (!res.ok) throw new Error('파일 목록을 불러오지 못했습니다')
  return res.json()
}

export async function uploadFile(file: File): Promise<StoredFileDto> {
  const form = new FormData()
  form.append('file', file)
  const res = await apiFetch('/api/files', { method: 'POST', body: form })
  if (!res.ok) throw new Error('파일 업로드에 실패했습니다')
  return res.json()
}

export async function deleteFile(id: number): Promise<void> {
  const res = await apiFetch(`/api/files/${id}`, { method: 'DELETE' })
  if (!res.ok) throw new Error('파일 삭제에 실패했습니다')
}

export function fileDownloadUrl(id: number): string {
  return `/api/files/${id}`
}
