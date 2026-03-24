import { PresenceAvatars } from './PresenceAvatars'

interface Props {
  title: string
  onTitleChange: (title: string) => void
  peers: { name: string; color: string; isAgent?: boolean }[]
  onShare: () => void
  onVersionHistory?: () => void
}

export function TopBar({ title, onTitleChange, peers, onShare, onVersionHistory }: Props) {
  return (
    <div className="topbar">
      <div className="topbar-left">
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
        {onVersionHistory && (
          <button className="btn btn-ghost" onClick={onVersionHistory}>History</button>
        )}
        <button className="btn" onClick={onShare}>Share</button>
      </div>
    </div>
  )
}
