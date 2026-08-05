import { useEffect, useState } from 'react'
import { supabase } from '../supabaseClient'
import { EXPENSE_CATEGORIES } from '../lib/businesses'
import { money } from '../lib/format'

export default function Expenses() {
  const [scope, setScope] = useState('overall')   // 'books'|'tofu'|'cantine'|'overall'
  const [category, setCategory] = useState('rent')
  const [amount, setAmount] = useState('')
  const [note, setNote] = useState('')
  const [rows, setRows] = useState([])
  const [busy, setBusy] = useState(false)

  async function load() {
    const { data } = await supabase.from('expenses')
      .select('*').order('created_at', { ascending: false }).limit(50)
    setRows(data || [])
  }
  useEffect(() => { load() }, [])
  useEffect(() => { setCategory(EXPENSE_CATEGORIES[scope][0]) }, [scope])

  async function add() {
    if (!amount || Number(amount) <= 0) return
    setBusy(true)
    const { error } = await supabase.from('expenses').insert({
      business: scope === 'overall' ? null : scope,
      category, amount: Number(amount), note: note || null,
    })
    setBusy(false)
    if (error) { alert(error.message); return }
    setAmount(''); setNote(''); load()
  }

  return (
    <div className="page">
      <h2>Expenses</h2>
      <div className="card">
        <label>Which business?</label>
        <div className="segmented wrap">
          {['books', 'tofu', 'cantine', 'overall'].map(s => (
            <button key={s} className={scope === s ? 'active' : ''} onClick={() => setScope(s)}>{s}</button>
          ))}
        </div>
        <label>Category</label>
        <select value={category} onChange={e => setCategory(e.target.value)}>
          {EXPENSE_CATEGORIES[scope].map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <label>Amount</label>
        <input type="number" step="any" value={amount} onChange={e => setAmount(e.target.value)} placeholder="0" />
        <label>Note (optional)</label>
        <input value={note} onChange={e => setNote(e.target.value)} placeholder="e.g. paid Jean for the week" />
        <button className="btn primary" disabled={busy} onClick={add}>Record expense</button>
      </div>

      <h3>Recent</h3>
      <div className="list">
        {rows.map(r => (
          <div className="listrow" key={r.id}>
            <div>
              <div className="strong">{r.category}</div>
              <div className="muted small">{r.business || 'overall'} · {new Date(r.created_at).toLocaleDateString()}{r.note ? ` · ${r.note}` : ''}</div>
            </div>
            <div className="strong">{money(r.amount)}</div>
          </div>
        ))}
      </div>
    </div>
  )
}
