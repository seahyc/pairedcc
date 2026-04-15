import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../api'

type PackageManager = 'npm' | 'pnpm' | 'bun'

const installCommands: Record<PackageManager, string> = {
  npm: 'npx @pairedcc/mcp-server',
  pnpm: 'pnpm dlx @pairedcc/mcp-server',
  bun: 'bunx @pairedcc/mcp-server',
}

const mcpConfig = `{
  "mcpServers": {
    "pairedcc": {
      "command": "npx",
      "args": ["@pairedcc/mcp-server"],
      "env": { "PAIREDCC_API_KEY": "your-key-here" }
    }
  }
}`

const features = [
  {
    title: 'Agent cursors',
    description: 'AI agents appear as live cursors in your document, just like human collaborators.',
  },
  {
    title: '@-mentions',
    description: 'Type @claude to summon an agent. It sees your context and responds inline.',
  },
  {
    title: 'Version history',
    description: 'Every edit is tracked with author attribution. Restore any snapshot instantly.',
  },
  {
    title: 'Any format',
    description: 'Markdown today. Rich documents, spreadsheets, and slides coming soon.',
    comingSoon: true,
  },
]

export function Landing() {
  const [activePm, setActivePm] = useState<PackageManager>('npm')
  const [copied, setCopied] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const navigate = useNavigate()

  const tryItNow = async () => {
    setCreating(true)
    try {
      const doc = await api('/api/documents', { method: 'POST', body: JSON.stringify({}) })
      sessionStorage.setItem('pairedcc:just-created', doc.id)
      navigate(`/d/${doc.id}`)
    } catch {
      setCreating(false)
    }
  }

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text)
    setCopied(label)
    setTimeout(() => setCopied(null), 2000)
  }

  return (
    <div className="landing">
      <nav className="landing-nav">
        <span className="landing-nav-logo">paired.cc</span>
        <a href="/login" className="btn">Sign in</a>
      </nav>

      {/* Hero */}
      <header className="landing-hero">
        <h1 className="landing-title">paired.cc</h1>
        <p className="landing-subtitle">
          Collaborative documents where AI agents are first-class participants
        </p>
        <button className="btn btn-primary btn-large" onClick={tryItNow} disabled={creating}>
          {creating ? 'Creating...' : 'Try it now'}
        </button>
        <p className="landing-hint">No account required. Creates an anonymous doc that expires in 24 hours.</p>
      </header>

      {/* Quick start */}
      <section className="landing-section" aria-label="Quick start">
        <h2>Connect your agent in 60 seconds</h2>

        <div className="landing-steps">
          <article className="landing-step">
            <h3>1. Install the MCP server</h3>
            <div className="tab-bar" role="tablist" aria-label="Package manager">
              {(Object.keys(installCommands) as PackageManager[]).map(pm => (
                <button
                  key={pm}
                  role="tab"
                  aria-selected={activePm === pm}
                  className={`tab ${activePm === pm ? 'active' : ''}`}
                  onClick={() => setActivePm(pm)}
                >
                  {pm}
                </button>
              ))}
            </div>
            <div className="code-block" role="tabpanel">
              <code>{installCommands[activePm]}</code>
              <button
                className="copy-btn"
                onClick={() => copyToClipboard(installCommands[activePm], 'install')}
              >
                {copied === 'install' ? 'Copied' : 'Copy'}
              </button>
            </div>
          </article>

          <article className="landing-step">
            <h3>2. Add to Claude Code config</h3>
            <div className="code-block">
              <pre><code>{mcpConfig}</code></pre>
              <button
                className="copy-btn"
                onClick={() => copyToClipboard(mcpConfig, 'config')}
              >
                {copied === 'config' ? 'Copied' : 'Copy'}
              </button>
            </div>
          </article>

          <article className="landing-step">
            <h3>3. Start collaborating</h3>
            <p className="step-description">
              Open a document. Your agent joins with a live cursor and can read, write, and respond to @-mentions.
            </p>
          </article>
        </div>
      </section>

      {/* Features */}
      <section className="landing-section" aria-label="Features">
        <h2>Built for agents and humans</h2>
        <div className="features-grid">
          {features.map(f => (
            <article key={f.title} className="feature-card">
              <h3>
                {f.title}
                {f.comingSoon && <span className="badge" style={{ marginLeft: 8 }}>coming soon</span>}
              </h3>
              <p>{f.description}</p>
            </article>
          ))}
        </div>
      </section>

      {/* Footer */}
      <footer className="landing-footer">
        <p>Built for agents and humans</p>
        <nav className="footer-links">
          <a href="/login">Sign in</a>
          <a href="https://github.com/pairedcc" target="_blank" rel="noopener noreferrer">GitHub</a>
          <a href="mailto:hello@paired.cc">Contact</a>
        </nav>
      </footer>
    </div>
  )
}
