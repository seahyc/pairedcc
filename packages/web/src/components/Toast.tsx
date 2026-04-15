import { useEffect, useState } from 'react'

interface Props {
  message: string
  /** ms before auto-dismiss; 0 disables auto-dismiss */
  duration?: number
  onClose?: () => void
}

export function Toast({ message, duration = 6000, onClose }: Props) {
  const [visible, setVisible] = useState(true)

  useEffect(() => {
    if (duration === 0) return
    const t = setTimeout(() => {
      setVisible(false)
      onClose?.()
    }, duration)
    return () => clearTimeout(t)
  }, [duration, onClose])

  if (!visible) return null

  return (
    <div className="toast" role="status" aria-live="polite">
      <span>{message}</span>
      <button
        className="toast-close"
        aria-label="Dismiss"
        onClick={() => { setVisible(false); onClose?.() }}
      >
        ×
      </button>
    </div>
  )
}
