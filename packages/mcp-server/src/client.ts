export class PairedClient {
  constructor(
    private baseUrl: string,
    private apiKey: string,
  ) {}

  private headers() {
    return { 'X-API-Key': this.apiKey, 'Content-Type': 'application/json' }
  }

  async listDocuments() {
    const res = await fetch(`${this.baseUrl}/api/agent/documents`, { headers: this.headers() })
    return res.json()
  }

  async createDocument(markdown: string, title?: string) {
    const res = await fetch(`${this.baseUrl}/api/documents/import`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({ markdown, ...(title ? { title } : {}) }),
    })
    return res.json()
  }

  async readDocument(docId: string) {
    const res = await fetch(`${this.baseUrl}/api/agent/documents/${docId}`, { headers: this.headers() })
    return res.json()
  }

  async editDocument(docId: string, anchor: string, newContent: string) {
    const res = await fetch(`${this.baseUrl}/api/agent/documents/${docId}/edit`, {
      method: 'POST',
      headers: this.headers(),
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
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({ content }),
    })
    return res.json()
  }

  async getPresence(docId: string) {
    const res = await fetch(`${this.baseUrl}/api/agent/documents/${docId}/presence`, { headers: this.headers() })
    return res.json()
  }

  async listComments(docId: string | undefined, status: 'open' | 'resolved' | 'all') {
    const path = docId
      ? `/api/agent/documents/${docId}/comments?status=${status}`
      : `/api/agent/comments?status=${status}`
    const res = await fetch(`${this.baseUrl}${path}`, { headers: this.headers() })
    return res.json()
  }

  async getCommentContext(docId: string, commentId: string) {
    const res = await fetch(
      `${this.baseUrl}/api/agent/documents/${docId}/comments/${commentId}/context`,
      { headers: this.headers() },
    )
    return res.json()
  }

  async replyComment(docId: string, commentId: string, body: string) {
    const res = await fetch(`${this.baseUrl}/api/agent/documents/${docId}/comments/${commentId}/reply`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({ body }),
    })
    return res.json()
  }

  async resolveComment(docId: string, commentId: string) {
    const res = await fetch(`${this.baseUrl}/api/agent/documents/${docId}/comments/${commentId}/resolve`, {
      method: 'POST',
      headers: this.headers(),
    })
    return res.json()
  }
}
