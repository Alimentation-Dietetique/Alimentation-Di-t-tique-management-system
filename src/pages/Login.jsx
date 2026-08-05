import { useState } from 'react'
import { supabase } from '../supabaseClient'

export default function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  async function signIn(e) {
    e.preventDefault()
    setBusy(true); setErr('')
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) setErr(error.message)
    setBusy(false)
  }

  return (
    <div className="center">
      <form className="card login" onSubmit={signIn}>
        <h1>Alimentation Diététique</h1>
        <p className="muted">Sign in to continue</p>
        <input placeholder="Email" value={email} onChange={e => setEmail(e.target.value)} autoComplete="username" />
        <input placeholder="Password" type="password" value={password} onChange={e => setPassword(e.target.value)} autoComplete="current-password" />
        {err && <div className="error">{err}</div>}
        <button className="btn primary" disabled={busy}>{busy ? '…' : 'Sign in'}</button>
      </form>
    </div>
  )
}
