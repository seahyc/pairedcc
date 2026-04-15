/**
 * Capability bridge between parent paired.cc doc and sandboxed agent-authored code.
 *
 * Security model: the iframe is served with `sandbox="allow-scripts"` only and
 * uses `srcdoc` (so the browser assigns an opaque origin). That means the
 * iframe CANNOT:
 *   - read parent cookies or localStorage
 *   - access parent DOM
 *   - make same-origin fetches (treated as cross-origin; CORS applies)
 *
 * The only way out is through the postMessage bridge exposed as `window.paired`
 * inside the iframe. This module defines the request/response protocol and
 * the parent-side handler that enforces capabilities.
 *
 * Message shape:
 *   Request:  { pairedcc: 1, id: string, method: string, args?: unknown[] }
 *   Response: { pairedcc: 1, id: string, ok: true, result?: unknown }
 *           | { pairedcc: 1, id: string, ok: false, error: string }
 *   Event:    { pairedcc: 1, event: 'state-change', state: Record<string, unknown> }
 */

export const PAIREDCC_MSG_VERSION = 1

export interface PairedRequest {
  pairedcc: 1
  id: string
  method: 'state.get' | 'state.set' | 'fetch' | 'db' | 'user' | 'ready'
  args?: unknown[]
}

export interface PairedResponse {
  pairedcc: 1
  id: string
  ok: boolean
  result?: unknown
  error?: string
}

export interface PairedEvent {
  pairedcc: 1
  event: 'state-change'
  state: Record<string, unknown>
}

export function isPairedMessage(m: unknown): m is PairedRequest | PairedResponse | PairedEvent {
  return !!m && typeof m === 'object' && (m as { pairedcc?: number }).pairedcc === PAIREDCC_MSG_VERSION
}

/**
 * The script injected into every sandbox iframe. Exposes `window.paired` as
 * the agent's API surface. All calls return Promises that resolve when the
 * parent responds over postMessage.
 *
 * This is a string because it has to be inlined into the iframe's srcdoc —
 * the iframe is isolated and can't import modules from the parent origin.
 */
export const SANDBOX_BOOTSTRAP = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<base target="_blank">
<style>
  html, body { margin: 0; padding: 0; font-family: -apple-system, system-ui, sans-serif; font-size: 14px; color: #e6e6e6; background: transparent; }
  body { padding: 8px; }
  * { box-sizing: border-box; }
  button { cursor: pointer; }
</style>
<script>
(function(){
  var pending = new Map();
  var stateListeners = [];
  var lastState = {};
  window.addEventListener('message', function(ev) {
    var m = ev.data;
    if (!m || m.pairedcc !== 1) return;
    if (m.event === 'state-change') {
      lastState = m.state || {};
      stateListeners.forEach(function(fn) { try { fn(lastState) } catch(e) {} });
      return;
    }
    if (m.id && pending.has(m.id)) {
      var p = pending.get(m.id);
      pending.delete(m.id);
      if (m.ok) p.resolve(m.result); else p.reject(new Error(m.error || 'unknown error'));
    }
  });
  function call(method, args) {
    return new Promise(function(resolve, reject) {
      var id = Math.random().toString(36).slice(2) + Date.now().toString(36);
      pending.set(id, { resolve: resolve, reject: reject });
      parent.postMessage({ pairedcc: 1, id: id, method: method, args: args || [] }, '*');
      setTimeout(function(){
        if (pending.has(id)) { pending.delete(id); reject(new Error('paired.' + method + ' timed out')) }
      }, 30000);
    });
  }
  window.paired = {
    state: {
      get: function(key) { return call('state.get', [key]) },
      set: function(patch) { return call('state.set', [patch]) },
      subscribe: function(fn) { stateListeners.push(fn); fn(lastState); return function(){ stateListeners = stateListeners.filter(function(l){return l!==fn}) } },
    },
    fetch: function(url, init) { return call('fetch', [url, init]) },
    db: function(connectorId, query, params) { return call('db', [connectorId, query, params || []]) },
    user: function() { return call('user', []) },
  };
  // Signal ready — parent can then seed initial state.
  call('ready', []).catch(function(){});
})();
</script>
</head>
<body>
<!--AGENT_HTML-->
</body>
</html>`

/**
 * Build the srcdoc string for a given agent-authored body. We concatenate
 * (rather than letting the agent write the full HTML) so we always get the
 * bridge script — agents can't accidentally disable it.
 */
export function buildSrcdoc(agentHtml: string): string {
  return SANDBOX_BOOTSTRAP.replace('<!--AGENT_HTML-->', agentHtml || '')
}

/** Hosts allowed for proxied `paired.fetch`. V1 allowlist. */
export const FETCH_ALLOWLIST = [
  'query1.finance.yahoo.com',
  'api.coingecko.com',
  'api.open-meteo.com',
  'hacker-news.firebaseio.com',
  'datasette.io',
  'api.github.com',
]

export function isAllowedFetchUrl(url: string): boolean {
  try {
    const u = new URL(url)
    if (u.protocol !== 'https:') return false
    return FETCH_ALLOWLIST.includes(u.hostname)
  } catch {
    return false
  }
}
