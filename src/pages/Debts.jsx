import { useEffect, useState, useMemo } from 'react'
import { supabase } from '../supabaseClient'
import { money } from '../lib/format'

export default function Debts() {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('')
  const [editingDebt, setEditingDebt] = useState(null)
  const [payingDebt, setPayingDebt] = useState(null)
  const [deletingDebt, setDeletingDebt] = useState(null)

  const [payForm, setPayForm] = useState({ amount: '', payment_method: 'cash' })
  const [editForm, setEditForm] = useState({ name: '', phone: '', amount_paid: '' })
  const [saving, setSaving] = useState(false)

  async function load() {
    setLoading(true)
    const { data } = await supabase
      .from('sales')
      .select('id,business,total,amount_paid,customer_id,created_at,customers(id,name,phone)')
      .order('created_at', { ascending: false })
    const owed = (data || [])
      .map(s => ({ ...s, outstanding: Number(s.total) - Number(s.amount_paid) }))
      .filter(s => s.outstanding > 0.001)
    setRows(owed)
    setLoading(false)
  }
  useEffect(() => { load() }, [])

  function startPay(sale) {
    setPayingDebt(sale)
    setPayForm({ amount: sale.outstanding, payment_method: 'cash' })
  }

  async function savePay() {
    if (!payingDebt) return
    const amt = Number(payForm.amount)
    if (!amt || amt <= 0) {
      alert('Please enter a valid payment amount.')
      return
    }

    setSaving(true)
    const { error } = await supabase.rpc('record_payment', { 
      p_sale_id: payingDebt.id, 
      p_amount: amt, 
      p_payment_method: payForm.payment_method 
    })
    setSaving(false)
    if (error) { alert(error.message); return }

    setPayingDebt(null)
    load()
  }

  function startEdit(sale) {
    setEditingDebt(sale)
    setEditForm({
      name: sale.customers?.name || '',
      phone: sale.customers?.phone || '',
      amount_paid: sale.amount_paid ?? '',
    })
  }

  function cancelEdit() {
    setEditingDebt(null)
    setEditForm({ name: '', phone: '', amount_paid: '' })
  }

  async function saveEdit() {
    if (!editingDebt) return
    const newPaid = Number(editForm.amount_paid)
    if (isNaN(newPaid) || newPaid < 0) {
      alert('Please enter a valid amount paid.')
      return
    }

    setSaving(true)
    let custId = editingDebt.customer_id

    // Update or create customer record
    if (custId) {
      if (editForm.name.trim()) {
        await supabase.from('customers').update({
          name: editForm.name.trim(),
          phone: editForm.phone.trim() || null,
        }).eq('id', custId)
      }
    } else if (editForm.name.trim()) {
      const { data: newCust } = await supabase.from('customers').insert({
        name: editForm.name.trim(),
        phone: editForm.phone.trim() || null,
      }).select().single()

      if (newCust) {
        custId = newCust.id
      }
    }

    // Update sale record
    const { error } = await supabase.from('sales').update({
      amount_paid: newPaid,
      customer_id: custId || null,
    }).eq('id', editingDebt.id)

    setSaving(false)
    if (error) { alert('Could not update debt: ' + error.message); return }

    cancelEdit()
    load()
  }

  async function confirmDeleteDebt() {
    if (!deletingDebt) return
    setSaving(true)
    let { error } = await supabase.rpc('delete_sale', { p_sale_id: deletingDebt.id })

    if (error) {
      console.warn('RPC delete_sale failed, falling back to manual deletion:', error.message)
      const { data: items } = await supabase.from('sale_items').select('product_id, quantity').eq('sale_id', deletingDebt.id)
      if (items && items.length) {
        for (const item of items) {
          if (item.product_id) {
            const { data: prod } = await supabase.from('products').select('stock, track_stock').eq('id', item.product_id).single()
            if (prod && prod.track_stock) {
              await supabase.from('products').update({ stock: Number(prod.stock || 0) + Number(item.quantity || 0) }).eq('id', item.product_id)
            }
          }
        }
      }
      const res = await supabase.from('sales').delete().eq('id', deletingDebt.id)
      error = res.error
    }

    setSaving(false)
    if (error) { alert('Could not delete debt record: ' + error.message); return }

    setDeletingDebt(null)
    load()
  }

  function getWhatsAppUrl(sale) {
    const phone = sale.customers?.phone ? sale.customers.phone.replace(/[^0-9]/g, '') : ''
    if (!phone) return null
    const name = sale.customers?.name || 'Client'
    const text = encodeURIComponent(`Hello ${name}, reminder from Alimentation Diététique regarding your outstanding debt of ${money(sale.outstanding)}. Thank you!`)
    return `https://wa.me/${phone}?text=${text}`
  }

  function exportCSV() {
    if (rows.length === 0) return
    const headers = ['Customer', 'Phone', 'Business', 'Date', 'Total Sale', 'Amount Paid', 'Outstanding Debt']
    const csvRows = [headers.join(',')]
    rows.forEach(r => {
      csvRows.push([
        `"${r.customers?.name || 'Walk-in'}"`,
        `"${r.customers?.phone || ''}"`,
        `"${r.business}"`,
        `"${new Date(r.created_at).toLocaleDateString()}"`,
        r.total,
        r.amount_paid,
        r.outstanding
      ].join(','))
    })
    const blob = new Blob([csvRows.join('\n')], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = `Debts_${new Date().toISOString().slice(0,10)}.csv`
    a.click()
  }

  const filteredRows = useMemo(() => {
    if (!filter.trim()) return rows
    const f = filter.toLowerCase()
    return rows.filter(r => 
      (r.customers?.name || '').toLowerCase().includes(f) || 
      (r.customers?.phone || '').toLowerCase().includes(f) || 
      (r.business || '').toLowerCase().includes(f)
    )
  }, [rows, filter])

  const totalOwed = rows.reduce((s, r) => s + r.outstanding, 0)

  return (
    <div className="page">
      <div className="header-row">
        <h2>Debts Management <span className="pill">{money(totalOwed)}</span></h2>
        {rows.length > 0 && (
          <button className="btn small ghost" onClick={exportCSV}>📥 Export CSV</button>
        )}
      </div>

      <input 
        type="text" 
        placeholder="🔍 Search debt table by customer name, phone, or business line..." 
        value={filter} 
        onChange={e => setFilter(e.target.value)}
        className="searchinput"
      />

      {loading && <p className="muted">Loading…</p>}
      {!loading && filteredRows.length === 0 && (
        <div className="card">
          <p className="muted">No matching debt records found 🎉</p>
        </div>
      )}

      {!loading && filteredRows.length > 0 && (
        <div className="table-responsive card">
          <table className="data-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Customer</th>
                <th>Phone</th>
                <th>Business</th>
                <th>Total Sale</th>
                <th>Amount Paid</th>
                <th>Outstanding Debt</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredRows.map(r => {
                const waUrl = getWhatsAppUrl(r)
                return (
                  <tr key={r.id}>
                    <td className="small muted">{new Date(r.created_at).toLocaleDateString()}</td>
                    <td className="strong">{r.customers?.name || 'Walk-in'}</td>
                    <td className="small">{r.customers?.phone || '—'}</td>
                    <td><span className="pill-badge">{r.business}</span></td>
                    <td className="strong">{money(r.total)}</td>
                    <td>{money(r.amount_paid)}</td>
                    <td><span className="badge owe">{money(r.outstanding)}</span></td>
                    <td>
                      <div className="actions-cell">
                        <button className="btn small primary" title="Record Debt Payment" onClick={() => startPay(r)}>💳 Pay</button>
                        <button className="btn small" title="Edit Debt Record & Customer Info" onClick={() => startEdit(r)}>✏️ Edit</button>
                        {waUrl && (
                          <a className="btn small whatsapp-btn" href={waUrl} target="_blank" rel="noreferrer" title="Send WhatsApp Reminder">
                            💬 WA
                          </a>
                        )}
                        <button className="btn small red-btn" title="Delete Debt Sale (Restores Stock)" onClick={() => setDeletingDebt(r)}>🗑️</button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Custom Modal: Record Debt Payment */}
      {payingDebt && (
        <div className="modal-overlay">
          <div className="modal-content card" style={{ maxWidth: '420px', margin: '0 auto' }}>
            <h3>💳 Record Debt Payment</h3>
            <p className="small muted">Customer: <strong>{payingDebt.customers?.name || 'Walk-in'}</strong> · Owes: <span className="debt-text">{money(payingDebt.outstanding)}</span></p>

            <label>Amount Received</label>
            <input 
              type="number" 
              step="any" 
              value={payForm.amount} 
              onChange={e => setPayForm({ ...payForm, amount: e.target.value })} 
              placeholder="Enter amount..." 
            />

            <label className="pay-label" style={{ marginTop: '10px' }}>Payment Method:</label>
            <div className="segmented">
              <button className={payForm.payment_method === 'cash' ? 'active' : ''} onClick={() => setPayForm({ ...payForm, payment_method: 'cash' })}>💵 Cash</button>
              <button className={payForm.payment_method === 'momo' ? 'active' : ''} onClick={() => setPayForm({ ...payForm, payment_method: 'momo' })}>📱 MoMo</button>
            </div>

            <div className="modal-actions" style={{ marginTop: '16px' }}>
              <button className="btn primary" disabled={saving} onClick={savePay}>
                {saving ? 'Recording...' : 'Confirm Payment'}
              </button>
              <button className="btn ghost" onClick={() => setPayingDebt(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* Custom Modal: Edit Debt & Customer Details */}
      {editingDebt && (
        <div className="modal-overlay">
          <div className="modal-content card" style={{ maxWidth: '440px', margin: '0 auto' }}>
            <h3>✏️ Edit Debt & Customer Details</h3>
            <p className="small muted">Sale Receipt #{editingDebt.id.slice(0, 8)} · Total: <strong>{money(editingDebt.total)}</strong></p>

            <label>Customer Name</label>
            <input 
              type="text" 
              value={editForm.name} 
              onChange={e => setEditForm({ ...editForm, name: e.target.value })} 
              placeholder="e.g. Jean Paul" 
            />

            <label>Customer Phone (for WhatsApp / Calls)</label>
            <input 
              type="text" 
              value={editForm.phone} 
              onChange={e => setEditForm({ ...editForm, phone: e.target.value })} 
              placeholder="e.g. +250 788 123 456" 
            />

            <label>Amount Paid So Far</label>
            <input 
              type="number" 
              step="any" 
              value={editForm.amount_paid} 
              onChange={e => setEditForm({ ...editForm, amount_paid: e.target.value })} 
              placeholder="0" 
            />

            <div className="small muted" style={{ marginTop: '4px' }}>
              Remaining Debt Balance: <strong className="debt-text">{money(Math.max(0, Number(editingDebt.total) - (Number(editForm.amount_paid) || 0)))}</strong>
            </div>

            <div className="modal-actions" style={{ marginTop: '16px' }}>
              <button className="btn primary" disabled={saving} onClick={saveEdit}>
                {saving ? 'Saving...' : 'Save Changes'}
              </button>
              <button className="btn ghost" onClick={cancelEdit}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* Custom Modal: Delete Debt Confirmation */}
      {deletingDebt && (
        <div className="modal-overlay">
          <div className="modal-content card" style={{ maxWidth: '400px', margin: '0 auto' }}>
            <h3 style={{ color: 'var(--red)' }}>🗑️ Cancel & Delete Debt?</h3>
            <p className="small">
              Are you sure you want to cancel and delete the debt receipt for <strong>{deletingDebt.customers?.name || 'Walk-in'}</strong> ({money(deletingDebt.total)})?
            </p>
            <p className="small muted">This action will automatically restore product stock quantity.</p>

            <div className="modal-actions" style={{ marginTop: '16px' }}>
              <button className="btn red-btn" disabled={saving} onClick={confirmDeleteDebt}>
                {saving ? 'Deleting...' : 'Yes, Delete & Restore Stock'}
              </button>
              <button className="btn ghost" onClick={() => setDeletingDebt(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}




