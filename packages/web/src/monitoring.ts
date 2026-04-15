/**
 * Lightweight error monitoring — opt-in via env.
 *
 * If `VITE_SENTRY_DSN` is set at build time, we dynamically load the Sentry
 * browser SDK and initialize it. If it's not set (the default in dev), we
 * do nothing — no bundle bloat, no overhead. Install the SDK with:
 *
 *   npm install @sentry/browser
 *
 * then set VITE_SENTRY_DSN in production.
 */
export async function initMonitoring(): Promise<void> {
  const dsn = import.meta.env.VITE_SENTRY_DSN as string | undefined
  if (!dsn) return

  try {
    // Obfuscate the specifier so Vite/Rollup doesn't try to resolve it at
    // build time. `@sentry/browser` must be installed at runtime for this
    // branch to succeed; otherwise the catch below silently skips.
    const name = ['@sentry', 'browser'].join('/')
    const Sentry = await import(/* @vite-ignore */ name)
    Sentry.init({
      dsn,
      tracesSampleRate: 0.1,
      environment: import.meta.env.MODE,
      release: import.meta.env.VITE_APP_VERSION || 'dev',
    })
    // eslint-disable-next-line no-console
    console.info('[paired.cc] Sentry initialized')
  } catch (e) {
    // @sentry/browser not installed — silently skip.
    // eslint-disable-next-line no-console
    console.warn('[paired.cc] VITE_SENTRY_DSN set but @sentry/browser not installed.')
  }

  // Always catch unhandled errors and reject, even without Sentry, to get
  // a clearer dev-console hint than the default "Uncaught".
  window.addEventListener('error', (e) => {
    if (dsn) return  // Sentry handles it
    // eslint-disable-next-line no-console
    console.error('[paired.cc] unhandled error:', e.error)
  })
  window.addEventListener('unhandledrejection', (e) => {
    if (dsn) return
    // eslint-disable-next-line no-console
    console.error('[paired.cc] unhandled rejection:', e.reason)
  })
}
