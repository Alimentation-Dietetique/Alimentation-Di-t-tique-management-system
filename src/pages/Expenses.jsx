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
  const [tableSearch, setTableSearch] = useState('')
  const [rows, setRows] = useState([])
  const [allCategories, setAllCategories] = useState([])
  const [editingId, setEditingId] = useState(null)
  const [busy, setBusy] = useState(false)

  async function load() {
    const { data } = await supabase.from('expenses')
      .select('*').order('created_at', { ascending: false }).limit(100)
    setRows(data || [])

    if (data) {
      const existing = data.map(r => r.category).filter(Boolean)
      setAllCategories(Array.from(new Set(existing)))
    }
  }

  useEffect(() => { load() }, [])

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

  const filteredExpenseRows = useMemo(() => {
    if (!tableSearch.trim()) return rows
    const q = tableSearch.toLowerCase()
    return rows.filter(r => 
      (r.category || '').toLowerCase().includes(q) || 
      (r.business || 'overall').toLowerCase().includes(q) || 
      (r.note || '').toLowerCase().includes(q)
    )
  }, [rows, tableSearch])

  useEffect(() => {
    if (!editingId) {
      setCategory(availableCategories[0] || 'other')
      setCustomTitle('')
    }
  }, [scope, availableCategories, editingId])

  function startEdit(r) {
    setEditingId(r.id)
    setScope(r.business || 'overall')
    setCategory(r.category)
    setCustomTitle(r.category)
    setAmount(r.amount)
    setNote(r.note || '')
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  function cancelEdit() {
    setEditingId(null)
    setAmount('')
    setNote('')
    setCustomTitle('')
  }

  async function save() {
    if (!amount || Number(amount) <= 0) return
    const finalCategory = (category === 'other' || category === 'new') 
      ? (customTitle.trim() || 'other') 
      : category

    if (!finalCategory) {
      alert('Please provide an expense category title.')
      return
    }

    setBusy(true)
    const payload = {
      business: scope === 'overall' ? null : scope,
      category: finalCategory, 
      amount: Number(amount), 
      note: note || null,
    }

    let res
    if (editingId) {
      res = await supabase.from('expenses').update(payload).eq('id', editingId)
    } else {
      res = await supabase.from('expenses').insert(payload)
    }

    setBusy(false)
    if (res.error) { alert(res.error.message); return }

    cancelEdit()
    load()
  }

  const [deletingExpense, setDeletingExpense] = useState(null)

  async function confirmDeleteExpense() {
    if (!deletingExpense) return
    setBusy(true)
    const { error } = await supabase.from('expenses').delete().eq('id', deletingExpense.id)
    setBusy(false)
    if (error) { alert(error.message); return }

    setDeletingExpense(null)
    load()
  }

  return (
    <div className="page">
      <h2>Expenses</h2>
      <div className="card">
        <h3>{editingId ? 'Edit Expense Record' : 'Record New Expense'}</h3>
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

        <div className="payrow">
          <button className="btn primary" disabled={busy} onClick={save}>
            {editingId ? 'Save Changes' : 'Record expense'}
          </button>
          {editingId && (
            <button className="btn ghost" onClick={cancelEdit}>Cancel</button>
          )}
        </div>
      </div>

      <div className="header-row">
        <h3>Expense Log Table</h3>
      </div>

      <input 
        type="text" 
        placeholder="🔍 Search expense table by category, business or note..." 
        value={tableSearch} 
        onChange={e => setTableSearch(e.target.value)} 
        className="searchinput"
      />

      <div className="table-responsive card">
        {filteredExpenseRows.length === 0 ? (
          <p className="muted">No matching expenses found.</p>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Business</th>
                <th>Category</th>
                <th>Amount</th>
                <th>Description</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredExpenseRows.map(r => (
                <tr key={r.id}>
                  <td className="small muted">{new Date(r.created_at).toLocaleDateString()}</td>
                  <td>
                    <span className="pill-badge">{r.business || 'Overall'}</span>
                  </td>
                  <td className="strong">{r.category}</td>
                  <td className="neg strong">{money(r.amount)}</td>
                  <td className="small">{r.note || '—'}</td>
                  <td>
                    <div className="actions-cell">
                      <button className="btn small" title="Edit Expense" onClick={() => startEdit(r)}>✏️</button>
                      <button className="btn small red-btn" title="Delete Expense" onClick={() => setDeletingExpense(r)}>🗑️</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Modal: Delete Expense Confirmation */}
      {deletingExpense && (
        <div className="modal-overlay">
          <div className="modal-content card" style={{ maxWidth: '400px', margin: '0 auto' }}>
            <h3 style={{ color: 'var(--red)' }}>🗑️ Delete Expense?</h3>
            <p className="small">Are you sure you want to delete expense <strong>"{deletingExpense.category}"</strong> of <strong>{money(deletingExpense.amount)}</strong>?</p>

            <div className="modal-actions" style={{ marginTop: '16px' }}>
              <button className="btn red-btn" disabled={busy} onClick={confirmDeleteExpense}>
                {busy ? 'Deleting...' : 'Yes, Delete Expense'}
              </button>
              <button className="btn ghost" onClick={() => setDeletingExpense(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}




