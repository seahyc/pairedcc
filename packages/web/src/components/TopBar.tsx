import { PresenceAvatars } from './PresenceAvatars'
import { THEMES } from '../themes'

interface Props {
  title: string
  onTitleChange: (title: string) => void
  peers: { name: string; color: string; isAgent?: boolean }[]
  onShare: () => void
  onVersionHistory?: () => void
  onOpenSidebar?: () => void
  theme?: string
  onThemeChange?: (id: string) => void
}

export function TopBar({ title, onTitleChange, peers, onShare, onVersionHistory, onOpenSidebar, theme, onThemeChange }: Props) {
  return (
    <div className="topbar">
      <div className="topbar-left">
        {onOpenSidebar && (
          <button
            className="topbar-menu"
            onClick={onOpenSidebar}
            aria-label="Open my docs"
            title="My docs"
          >
            ☰
          </button>
        )}
        <a href="/" className="topbar-logo">
          <img src="/logo.svg" alt="paired.cc" className="topbar-logo-img" />
          paired.cc
        </a>
        <span className="topbar-sep">&rsaquo;</span>
        <input
          className="topbar-title"
          value={title}
          onChange={e => onTitleChange(e.target.value)}
        />
      </div>
      <div className="topbar-right">
        <PresenceAvatars peers={peers} />
        {onThemeChange && (
          <select
            className="topbar-theme"
            value={theme}
            onChange={e => onThemeChange(e.target.value)}
            title="Theme"
          >
            {THEMES.map(t => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>
        )}
        {onVersionHistory && (
          <button className="btn btn-ghost" onClick={onVersionHistory}>History</button>
        )}
        <button className="btn" onClick={onShare}>Share</button>
      </div>
    </div>
  )
}
