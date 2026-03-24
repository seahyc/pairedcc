import * as Y from 'yjs'

export class DocManager {
  private docs = new Map<string, Y.Doc>()

  getOrCreate(docId: string): Y.Doc {
    let doc = this.docs.get(docId)
    if (!doc) {
      doc = new Y.Doc()
      this.docs.set(docId, doc)
    }
    return doc
  }

  getMarkdown(docId: string): string {
    const doc = this.docs.get(docId)
    if (!doc) return ''
    // Tiptap stores content as XML fragment; for basic text, read from 'content'
    const text = doc.getText('content')
    return text.toString()
  }

  applyUpdate(docId: string, update: Uint8Array): void {
    const doc = this.getOrCreate(docId)
    Y.applyUpdate(doc, update)
  }

  getState(docId: string): Uint8Array | null {
    const doc = this.docs.get(docId)
    if (!doc) return null
    return Y.encodeStateAsUpdate(doc)
  }

  destroy(docId: string): void {
    const doc = this.docs.get(docId)
    if (doc) {
      doc.destroy()
      this.docs.delete(docId)
    }
  }
}
