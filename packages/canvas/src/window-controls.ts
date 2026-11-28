import type { Editor } from "tldraw";

/** The window's own controls (tool strip, zoom bar, panels, notices) drawn over the canvas. */
const CONTROLS = ".topbar, .tool-strip, .bottom-left, .zoom-controls, .left-panel, .right-panel, .toast";

/**
 * The window's controls as page rectangles: something placed under the tool strip or the zoom
 * bar is as hidden as something under a card. Only what is shown counts; none outside a browser.
 */
export function windowControls(editor: Editor) {
  if (typeof document === "undefined") return [];
  const rects: { x: number; y: number; w: number; h: number }[] = [];
  for (const el of document.querySelectorAll(CONTROLS)) {
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) continue;
    const a = editor.screenToPage({ x: r.left, y: r.top }), b = editor.screenToPage({ x: r.right, y: r.bottom });
    rects.push({ x: a.x, y: a.y, w: b.x - a.x, h: b.y - a.y });
  }
  return rects;
}
