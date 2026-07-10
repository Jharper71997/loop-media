'use client'

import { useEffect, useState } from 'react'
import { Moon, Sun } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { THEMES, THEME_COOKIE, THEME_COOKIE_MAX_AGE, type Theme } from '@/lib/theme'

// Reads the theme the SERVER already applied to <html> (lib/theme.ts sets the
// class from the cookie). We can't touch the DOM during SSR, so the icon is
// revealed after mount to guarantee it matches the real theme — the colors
// themselves are correct from first paint regardless of this component.
function currentTheme(): Theme {
  if (typeof document === 'undefined') return 'dark'
  return document.documentElement.classList.contains('light') ? 'light' : 'dark'
}

export function ThemeToggle({ className }: { className?: string }) {
  const [theme, setTheme] = useState<Theme>('dark')
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setTheme(currentTheme())
    setMounted(true)
  }, [])

  function toggle() {
    const next: Theme = theme === 'dark' ? 'light' : 'dark'
    const root = document.documentElement
    // Swap the theme class live — CSS variables update instantly, no re-render.
    root.classList.remove(...THEMES)
    root.classList.add(next)
    // Persist so the next server render paints this theme with no flash/JS.
    document.cookie = `${THEME_COOKIE}=${next}; path=/; max-age=${THEME_COOKIE_MAX_AGE}; samesite=lax`
    setTheme(next)
  }

  const isDark = theme === 'dark'
  const label = isDark ? 'Switch to light theme' : 'Switch to dark theme'

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      onClick={toggle}
      aria-label={label}
      title={label}
      className={className}
    >
      {mounted && !isDark ? <Moon className="size-4" /> : <Sun className="size-4" />}
    </Button>
  )
}
