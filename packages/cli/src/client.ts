export class PairedClient {
  constructor(private baseUrl: string, private apiKey?: string) {}

  private headers() {
    const h: Record<string, string> = { 'Content-Type': 'application/json' }
    if (this.apiKey) h['X-API-Key'] = this.apiKey
    return h
  }

  /**
   * Create a doc from markdown in one call. No API key needed → anonymous doc
   * (24h, link-shareable). With a key → owned doc. Returns the doc plus a
   * shareable `url`.
   */
  async createDocument(markdown: string, title?: string) {
    const res = await fetch(`${this.baseUrl}/api/documents/import`, {
      method: 'POST', headers: this.headers(),
      body: JSON.stringify({ markdown, ...(title ? { title } : {}) }),
    })
    return res.json()
  }

  async listDocuments() {
    const res = await fetch(`${this.baseUrl}/api/agent/documents`, { headers: this.headers() })
    return res.json()
  }

  async readDocument(docId: string) {
    const res = await fetch(`${this.baseUrl}/api/agent/documents/${docId}`, { headers: this.headers() })
    return res.json()
  }

  async editDocument(docId: string, anchor: string, newContent: string) {
    const res = await fetch(`${this.baseUrl}/api/agent/documents/${docId}/edit`, {
      method: 'POST', headers: this.headers(),
      body: JSON.stringify({ anchor, new_content: newContent }),
    })
    return res.json()
  }

  async getMentions(docId: string) {
    const res = await fetch(`${this.baseUrl}/api/agent/documents/${docId}/mentions`, { headers: this.headers() })
    return res.json()
  }

  async respondToMention(docId: string, mentionId: string, content: string) {
    const res = await fetch(`${this.baseUrl}/api/agent/documents/${docId}/mentions/${mentionId}/respond`, {
      method: 'POST', headers: this.headers(),
      body: JSON.stringify({ content }),
    })
    return res.json()
  }

  async getPresence(docId: string) {
    const res = await fetch(`${this.baseUrl}/api/agent/documents/${docId}/presence`, { headers: this.headers() })
    return res.json()
  }

  // ---- Comments (agent inbox) ----

  /**
   * List comments assigned to the agent (via an @agent tag or the human
   * "Assign to agent" toggle). Across all docs the key can access, or scoped to
   * one doc. Each item carries its block_anchor and the CURRENT block text.
   */
  async listComments(docId: string | undefined, status: 'open' | 'resolved' | 'all' = 'open') {
    const path = docId
      ? `/api/agent/documents/${docId}/comments?status=${status}`
      : `/api/agent/comments?status=${status}`
    const res = await fetch(`${this.baseUrl}${path}`, { headers: this.headers() })
    return res.json()
  }

  /** Full context for one comment: thread fields + current block text. */
  async getCommentContext(docId: string, commentId: string) {
    const res = await fetch(
      `${this.baseUrl}/api/agent/documents/${docId}/comments/${commentId}/context`,
      { headers: this.headers() },
    )
    return res.json()
  }

  async replyComment(docId: string, commentId: string, body: string) {
    const res = await fetch(`${this.baseUrl}/api/agent/documents/${docId}/comments/${commentId}/reply`, {
      method: 'POST', headers: this.headers(),
      body: JSON.stringify({ body }),
    })
    return res.json()
  }

  async resolveComment(docId: string, commentId: string) {
    const res = await fetch(`${this.baseUrl}/api/agent/documents/${docId}/comments/${commentId}/resolve`, {
      method: 'POST', headers: this.headers(),
    })
    return res.json()
  }
}
