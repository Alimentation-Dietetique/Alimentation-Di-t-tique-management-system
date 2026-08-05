import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../supabaseClient'
import { EXPENSE_CATEGORIES } from '../lib/businesses'
import { money } from '../lib/format'

export default function Expenses() {
  const [scope, setScope] = useState('overall')   // 'books'|'tofu'|'cantine'|'overall'
  const [category, setCategory] = useState('')
  const [customTitle, setCustomTitle] = useState('')
  const [amount, setAmount] = useState('')
  const [note, setNote] = useState('')
  const [categorySearch, setCategorySearch] = useState('')
  const [rows, setRows] = useState([])
  const [allCategories, setAllCategories] = useState([])
  const [busy, setBusy] = useState(false)

  async function load() {
    const { data } = await supabase.from('expenses')
      .select('*').order('created_at', { ascending: false }).limit(100)
    setRows(data || [])

    // Fetch distinct category history to prevent duplicates
    if (data) {
      const existing = data.map(r => r.category).filter(Boolean)
      setAllCategories(Array.from(new Set(existing)))
    }
  }

  useEffect(() => { load() }, [])

  // Combine standard presets with historical custom categories for this scope
  const availableCategories = useMemo(() => {
    const defaultPresets = EXPENSE_CATEGORIES[scope] || []
    const merged = Array.from(new Set([...defaultPresets, ...allCategories]))
    if (!merged.includes('other')) merged.push('other')
    return merged
  }, [scope, allCategories])

  const filteredCategories = useMemo(() => {
    if (!categorySearch.trim()) return availableCategories
    const q = categorySearch.toLowerCase()
    return availableCategories.filter(c => c.toLowerCase().includes(q))
  }, [availableCategories, categorySearch])

  useEffect(() => {
    setCategory(availableCategories[0] || 'other')
    setCustomTitle('')
  }, [scope, availableCategories])

  async function add() {
    if (!amount || Number(amount) <= 0) return
    const finalCategory = (category === 'other' || category === 'new') 
      ? (customTitle.trim() || 'other') 
      : category

    if (!finalCategory) {
      alert('Please provide an expense category title.')
      return
    }

    setBusy(true)
    const { error } = await supabase.from('expenses').insert({
      business: scope === 'overall' ? null : scope,
      category: finalCategory, 
      amount: Number(amount), 
      note: note || null,
    })
    setBusy(false)
    if (error) { alert(error.message); return }

    setAmount('')
    setNote('')
    setCustomTitle('')
    load()
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

        <label>Select or Search Category</label>
        <input 
          type="text"
          placeholder="🔍 Search existing category..."
          value={categorySearch}
          onChange={e => setCategorySearch(e.target.value)}
          className="searchinput"
        />

        <select value={category} onChange={e => setCategory(e.target.value)}>
          {filteredCategories.map(c => <option key={c} value={c}>{c}</option>)}
          <option value="new">+ Add New Custom Category Title</option>
        </select>

        {(category === 'other' || category === 'new') && (
          <div>
            <label>Custom Expense Title</label>
            <input 
              value={customTitle} 
              onChange={e => setCustomTitle(e.target.value)} 
              placeholder="e.g. Generator Fuel, Water Bill, Equipment" 
            />
          </div>
        )}

        <label>Amount</label>
        <input type="number" step="any" value={amount} onChange={e => setAmount(e.target.value)} placeholder="0" />

        <label>Description / Note (optional)</label>
        <input value={note} onChange={e => setNote(e.target.value)} placeholder="e.g. paid Jean for the week, receipt #42" />

        <button className="btn primary" disabled={busy} onClick={add}>Record expense</button>
      </div>

      <h3>Recent Expenses</h3>
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

