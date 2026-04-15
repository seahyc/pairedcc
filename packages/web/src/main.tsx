import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { initMonitoring } from './monitoring'
import './styles/globals.css'

initMonitoring()

createRoot(document.getElementById('root')!).render(
  <StrictMode><App /></StrictMode>
)
