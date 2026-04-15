/**
 * Named themes — flip the editor's visual presentation globally.
 *
 * A theme is just a set of CSS custom-property overrides applied to a root
 * element. Agents can read/set the active theme via doc metadata (V2) or
 * via a URL query param (?theme=editorial). V1: per-doc class on the
 * editor page, persistable to localStorage.
 */

export interface Theme {
  id: string
  name: string
  description: string
  /** CSS that's injected as an override when the theme is active. */
  css: string
}

export const THEMES: Theme[] = [
  {
    id: 'minimal',
    name: 'Minimal',
    description: 'The default. Get out of the way, let content shine.',
    css: '',  // baseline
  },
  {
    id: 'editorial',
    name: 'Editorial',
    description: 'NYT-style — serif headlines, readable column, generous whitespace.',
    css: `
      :root.theme-editorial {
        --font-serif: ui-serif, 'Iowan Old Style', Georgia, 'Times New Roman', serif;
      }
      .theme-editorial .tiptap-editor { max-width: 680px; }
      .theme-editorial .ProseMirror { font-family: var(--font-serif); font-size: 18px; line-height: 1.75; letter-spacing: 0.005em; }
      .theme-editorial .ProseMirror h1 { font-family: var(--font-serif); font-weight: 700; font-size: 44px; line-height: 1.15; margin-top: 32px; }
      .theme-editorial .ProseMirror h2 { font-family: var(--font-serif); font-weight: 700; font-size: 30px; line-height: 1.2; margin-top: 32px; }
      .theme-editorial .ProseMirror h3 { font-family: var(--font-serif); font-weight: 600; font-size: 22px; margin-top: 24px; }
      .theme-editorial .ProseMirror p:first-of-type::first-letter {
        font-family: var(--font-serif); font-weight: 700; font-size: 3.2em;
        float: left; line-height: 0.95; margin: 4px 8px 0 0; color: var(--primary);
      }
      .theme-editorial .ProseMirror blockquote { font-family: var(--font-serif); font-style: italic; font-size: 20px; border-left: 3px solid var(--primary); padding-left: 16px; }
      .theme-editorial .ProseMirror code { font-family: ui-monospace, monospace; font-size: 0.92em; }
    `,
  },
]

export const DEFAULT_THEME = 'minimal'
const STORAGE_KEY = 'pairedcc:theme'

export function getActiveTheme(): string {
  if (typeof window === 'undefined') return DEFAULT_THEME
  return localStorage.getItem(STORAGE_KEY) || DEFAULT_THEME
}

export function setActiveTheme(id: string): void {
  if (typeof window === 'undefined') return
  localStorage.setItem(STORAGE_KEY, id)
  applyTheme(id)
}

/** Applies theme classes + injects CSS for all themes once into <head>. */
export function applyTheme(id: string): void {
  if (typeof document === 'undefined') return
  const root = document.documentElement
  THEMES.forEach(t => root.classList.toggle(`theme-${t.id}`, t.id === id))
  // Inject CSS once.
  let style = document.getElementById('pcc-theme-style') as HTMLStyleElement | null
  if (!style) {
    style = document.createElement('style')
    style.id = 'pcc-theme-style'
    document.head.appendChild(style)
    style.textContent = THEMES.map(t => t.css).join('\n')
  }
}
