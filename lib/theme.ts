// Single source of truth for the theme system.
//
// Themes are applied as a class on the <html> element (see app/globals.css).
// The class is rendered SERVER-SIDE from the `theme` cookie in app/layout.tsx,
// so the first paint is already themed with zero client JavaScript. The toggle
// (components/ThemeToggle.tsx) only runs on user interaction, never on load.
//
// Adding a theme later is a two-step change with NO refactor of components:
//   1) add its class block in app/globals.css (copy an existing one, retune),
//   2) add its name to THEMES below.
// Semantic tokens (--background, --primary, ...) are the stable contract every
// component consumes, so new themes never touch component code.

export const THEMES = ['dark', 'light'] as const
export type Theme = (typeof THEMES)[number]

// Loop Network is a dark-first brand (near-black canvas + gold), so an absent
// preference resolves to dark. This is also the value baked into :root in CSS,
// which keeps the un-toggled first paint on-brand with no flash.
export const DEFAULT_THEME: Theme = 'dark'

export const THEME_COOKIE = 'theme'
// Persist the choice long enough that returning visitors never re-flash.
export const THEME_COOKIE_MAX_AGE = 60 * 60 * 24 * 365 // 1 year

export function isTheme(value: string | null | undefined): value is Theme {
  return value === 'dark' || value === 'light'
}

export function resolveTheme(cookieValue: string | null | undefined): Theme {
  return isTheme(cookieValue) ? cookieValue : DEFAULT_THEME
}
