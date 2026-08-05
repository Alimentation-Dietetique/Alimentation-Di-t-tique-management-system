import { useEffect, useState } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { supabase } from './supabaseClient'
import Nav from './components/Nav.jsx'
import Login from './pages/Login.jsx'
import Sell from './pages/Sell.jsx'
import Debts from './pages/Debts.jsx'
import Expenses from './pages/Expenses.jsx'
import Products from './pages/Products.jsx'
import Dashboard from './pages/Dashboard.jsx'

export default function App() {
  const [session, setSession] = useState(undefined) // undefined = loading

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s))
    return () => sub.subscription.unsubscribe()
  }, [])

  if (session === undefined) return <div className="center muted">Loading…</div>
  if (!session) return <Login />

  return (
    <div className="app">
      <main className="content">
        <Routes>
          <Route path="/sell" element={<Sell seller={session.user.email} />} />
          <Route path="/debts" element={<Debts />} />
          <Route path="/expenses" element={<Expenses />} />
          <Route path="/products" element={<Products />} />
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="*" element={<Navigate to="/sell" replace />} />
        </Routes>
      </main>
      <Nav onSignOut={() => supabase.auth.signOut()} />
    </div>
  )
}
