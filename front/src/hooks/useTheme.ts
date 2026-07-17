import { useEffect, useState } from 'react'

export type Theme = 'light' | 'dark'

const THEME_KEY = 'kanban-board-theme'

function getInitialTheme(): Theme {
  try {
    const stored = localStorage.getItem(THEME_KEY)
    if (stored === 'light' || stored === 'dark') return stored
  } catch {
    // localStorage 접근 불가 시 OS 설정으로
  }
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

export function useTheme() {
  const [theme, setTheme] = useState<Theme>(getInitialTheme)

  useEffect(() => {
    document.documentElement.dataset.theme = theme
  }, [theme])

  // 명시적으로 토글했을 때만 저장 — 저장 전에는 OS 설정을 따라간다
  function toggle() {
    const next: Theme = theme === 'light' ? 'dark' : 'light'
    try {
      localStorage.setItem(THEME_KEY, next)
    } catch {
      // 저장 실패해도 이번 세션에는 적용
    }
    setTheme(next)
  }

  return { theme, toggle }
}
