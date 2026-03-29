import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { Login } from './pages/Login'
import { Dashboard } from './pages/Dashboard'
import { Editor } from './pages/Editor'
import { Settings } from './pages/Settings'
import { HomepageRedirect } from './pages/HomepageRedirect'
import { useAuth } from './hooks/useAuth'

export function App() {
  const { user, loading } = useAuth()
  if (loading) return <div className="loading">Loading...</div>

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={user ? <Navigate to="/" /> : <Login />} />
        <Route path="/" element={user ? <Dashboard /> : <HomepageRedirect />} />
        <Route path="/new" element={<HomepageRedirect />} />
        <Route path="/d/:docId" element={<Editor />} />
        <Route path="/settings" element={user ? <Settings /> : <Navigate to="/login" />} />
      </Routes>
    </BrowserRouter>
  )
}
