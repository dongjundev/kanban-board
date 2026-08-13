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

/** 서버 반영 전에 목록에 먼저 보여주는 항목은 pending으로 구분한다. */
type LocalNote = NoteDto & { pending?: boolean }

/** 텍스트 메모 + 파일 업로드 페이지 (서버 저장). */
export function MemoPage() {
  const [notes, setNotes] = useState<LocalNote[]>([])
  const [files, setFiles] = useState<StoredFileDto[]>([])
  const [text, setText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  // 제출은 이 ref를 동기적으로 읽고 비운다 — ⌘/Ctrl+Enter 연타(키 자동반복 포함)는
  // 리렌더 전의 낡은 state를 보고 같은 내용을 거듭 저장하므로, state가 아니라
  // 즉시 비워지는 ref가 중복을 막는다.
  const textRef = useRef('')
  // 임시 항목 id — 서버 id(양수)와 절대 겹치지 않게 음수를 쓴다
  const tempIdRef = useRef(-1)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    Promise.all([memoApi.listNotes(), memoApi.listFiles()])
      .then(([n, f]) => {
        setNotes(n)
        setFiles(f)
      })
      .catch((e) => setError(errorMessage(e)))
  }, [])

  function handleTextChange(value: string) {
    textRef.current = value
    setText(value)
  }

  // 낙관적 저장 — 서버 응답을 기다리지 않고 즉시 목록에 반영하고 입력칸을 비운다.
  // 배포 VM의 응답이 수십 ms~수 초까지 흔들려서(디스크/CPU 버스트 + 사내망 경유),
  // 왕복을 기다리게 하면 긴 텍스트를 붙여넣을 때마다 멈춘 것처럼 느껴진다.
  // 실패하면 임시 항목을 걷어내고 내용을 입력칸에 되돌린다(유실 없음).
  async function handleSaveNote() {
    const content = textRef.current.trim()
    if (!content) return
    textRef.current = ''
    setText('')
    setError(null)
    const tempId = tempIdRef.current--
    const temp: LocalNote = { id: tempId, content, createdAt: new Date().toISOString(), pending: true }
    setNotes((prev) => [temp, ...prev])
    try {
      const saved = await memoApi.createNote(content)
      setNotes((prev) => prev.map((n) => (n.id === tempId ? saved : n)))
    } catch (e) {
      setNotes((prev) => prev.filter((n) => n.id !== tempId))
      // 실패 사이에 새로 입력한 내용이 있으면 덮지 않고 위에 얹는다 — 어느 쪽도 잃지 않게
      const typedMeanwhile = textRef.current
      const restored = typedMeanwhile ? `${content}\n\n${typedMeanwhile}` : content
      textRef.current = restored
      setText(restored)
      setError(`${errorMessage(e)} — 작성한 내용을 입력칸에 되돌렸습니다`)
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

  // 링크(<a href>)로 직접 받으면 401이 apiFetch를 거치지 않아, 세션이 끊긴 뒤
  // 클릭해도 아무 일 없이 조용히 실패한다. 내려받은 뒤 blob으로 저장한다.
  async function handleDownload(f: StoredFileDto) {
    setError(null)
    try {
      const blob = await memoApi.downloadFile(f.id)
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = f.filename
      a.click()
      // 즉시 해제하면 브라우저가 아직 읽기 전이라 저장이 취소될 수 있다
      setTimeout(() => URL.revokeObjectURL(url), 10000)
    } catch (e) {
      setError(errorMessage(e))
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
              onChange={(e) => handleTextChange(e.target.value)}
              placeholder="메모를 입력하세요… (Ctrl/⌘+Enter로 저장)"
              onKeyDown={(e) => {
                if (e.nativeEvent.isComposing) return
                if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') handleSaveNote()
              }}
            />
            <button className="btn btn-primary" onClick={handleSaveNote} disabled={!text.trim()}>
              저장
            </button>
          </div>
          <ul className="memo-list">
            {notes.map((n) => (
              <li key={n.id} className={`memo-item${n.pending ? ' pending' : ''}`}>
                <div className="memo-item-body">{n.content}</div>
                <div className="memo-item-meta">
                  <span>{n.pending ? '저장 중…' : formatTime(n.createdAt)}</span>
                  {/* 서버 id가 나오기 전에는 지울 수 없으므로 pending 동안 삭제 버튼을 감춘다 */}
                  {!n.pending && (
                    <button className="memo-icon-btn" aria-label="메모 삭제" onClick={() => handleDeleteNote(n.id)}>
                      <Trash2 size={15} />
                    </button>
                  )}
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
                <button className="file-name" onClick={() => handleDownload(f)}>
                  <Download size={15} /> {f.filename}
                </button>
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
