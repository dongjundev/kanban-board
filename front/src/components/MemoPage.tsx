import { useEffect, useRef, useState } from 'react'
import { Download, FileText, StickyNote, Trash2, Upload } from 'lucide-react'
import type { NoteDto, StoredFileDto } from '../memoApi'
import * as memoApi from '../memoApi'

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString('ko-KR', { dateStyle: 'medium', timeStyle: 'short' })
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : '오류가 발생했습니다'
}

/** 텍스트 메모 + 파일 업로드 페이지 (서버 저장). */
export function MemoPage() {
  const [notes, setNotes] = useState<NoteDto[]>([])
  const [files, setFiles] = useState<StoredFileDto[]>([])
  const [text, setText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    Promise.all([memoApi.listNotes(), memoApi.listFiles()])
      .then(([n, f]) => {
        setNotes(n)
        setFiles(f)
      })
      .catch((e) => setError(errorMessage(e)))
  }, [])

  async function handleSaveNote() {
    const content = text.trim()
    if (!content) return
    setSaving(true)
    setError(null)
    try {
      const note = await memoApi.createNote(content)
      setNotes((prev) => [note, ...prev])
      setText('')
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setSaving(false)
    }
  }

  async function handleDeleteNote(id: number) {
    try {
      await memoApi.deleteNote(id)
      setNotes((prev) => prev.filter((n) => n.id !== id))
    } catch (e) {
      setError(errorMessage(e))
    }
  }

  async function handleUpload(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) return
    setUploading(true)
    setError(null)
    try {
      for (const file of Array.from(fileList)) {
        const saved = await memoApi.uploadFile(file)
        setFiles((prev) => [saved, ...prev])
      }
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  async function handleDeleteFile(id: number) {
    try {
      await memoApi.deleteFile(id)
      setFiles((prev) => prev.filter((f) => f.id !== id))
    } catch (e) {
      setError(errorMessage(e))
    }
  }

  return (
    <div className="memo-page">
      {error && <div className="memo-error">{error}</div>}
      <div className="memo-columns">
        <section className="memo-section">
          <h2 className="memo-title">
            <StickyNote size={18} /> 메모
          </h2>
          <div className="memo-composer">
            <textarea
              className="memo-textarea"
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="메모를 입력하세요… (Ctrl/⌘+Enter로 저장)"
              onKeyDown={(e) => {
                if (e.nativeEvent.isComposing) return
                if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') handleSaveNote()
              }}
            />
            <button className="btn btn-primary" onClick={handleSaveNote} disabled={saving || !text.trim()}>
              저장
            </button>
          </div>
          <ul className="memo-list">
            {notes.map((n) => (
              <li key={n.id} className="memo-item">
                <div className="memo-item-body">{n.content}</div>
                <div className="memo-item-meta">
                  <span>{formatTime(n.createdAt)}</span>
                  <button className="memo-icon-btn" aria-label="메모 삭제" onClick={() => handleDeleteNote(n.id)}>
                    <Trash2 size={15} />
                  </button>
                </div>
              </li>
            ))}
            {notes.length === 0 && <li className="memo-empty">아직 메모가 없습니다.</li>}
          </ul>
        </section>

        <section className="memo-section">
          <h2 className="memo-title">
            <FileText size={18} /> 파일
          </h2>
          <div className="memo-upload">
            <input ref={fileInputRef} type="file" multiple hidden onChange={(e) => handleUpload(e.target.files)} />
            <button className="btn btn-primary" onClick={() => fileInputRef.current?.click()} disabled={uploading}>
              <Upload size={16} /> {uploading ? '업로드 중…' : '파일 선택'}
            </button>
          </div>
          <ul className="memo-list">
            {files.map((f) => (
              <li key={f.id} className="memo-item file-item">
                <a className="file-name" href={memoApi.fileDownloadUrl(f.id)} download={f.filename}>
                  <Download size={15} /> {f.filename}
                </a>
                <div className="memo-item-meta">
                  <span>
                    {formatBytes(f.size)} · {formatTime(f.createdAt)}
                  </span>
                  <button className="memo-icon-btn" aria-label="파일 삭제" onClick={() => handleDeleteFile(f.id)}>
                    <Trash2 size={15} />
                  </button>
                </div>
              </li>
            ))}
            {files.length === 0 && <li className="memo-empty">아직 업로드된 파일이 없습니다.</li>}
          </ul>
        </section>
      </div>
    </div>
  )
}
