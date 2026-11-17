import { createRoot } from 'react-dom/client'
import App from './App'

const container = document.getElementById('root')
if (!container) throw new Error('Canvas root is missing')
createRoot(container).render(<App />)
