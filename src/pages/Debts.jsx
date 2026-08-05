import { useEffect, useState, useMemo } from 'react'
import { supabase } from '../supabaseClient'
import { money } from '../lib/format'

export default function Debts() {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('')

  async function load() {
    setLoading(true)
    const { data } = await supabase
      .from('sales')
      .select('id,business,total,amount_paid,created_at,customers(name,phone)')
      .order('created_at', { ascending: false })
    const owed = (data || [])
      .map(s => ({ ...s, outstanding: Number(s.total) - Number(s.amount_paid) }))
      .filter(s => s.outstanding > 0.001)
    setRows(owed)
    setLoading(false)
  }
  useEffect(() => { load() }, [])

  async function pay(sale) {
    const input = prompt(`Payment for ${sale.customers?.name || 'customer'} — owes ${money(sale.outstanding)}.\nAmount received:`, sale.outstanding)
    if (input == null) return
    const amount = Number(input)
    if (!amount || amount <= 0) return

    const methodChoice = prompt(`Payment method?\nType 'cash' for Cash, or 'momo' for Mobile Money:`, 'cash')
    const payment_method = (methodChoice && methodChoice.toLowerCase().includes('momo')) ? 'momo' : 'cash'

    const { error } = await supabase.rpc('record_payment', { 
      p_sale_id: sale.id, 
      p_amount: amount, 
      p_payment_method: payment_method 
    })
    if (error) { alert(error.message); return }
    load()
  }

  async function editDebt(sale) {
    const input = prompt(`Update amount paid for debt sale #${sale.id.slice(0, 8)} (Total: ${money(sale.total)}, Currently paid: ${money(sale.amount_paid)}):`, sale.amount_paid)
    if (input == null) return
    const newPaid = Number(input)
    if (isNaN(newPaid) || newPaid < 0) return
    const { error } = await supabase.from('sales').update({ amount_paid: newPaid }).eq('id', sale.id)
    if (error) { alert(error.message); return }
    load()
  }

  async function deleteDebt(sale) {
    if (!confirm(`Delete/Cancel debt record for ${sale.customers?.name || 'Customer'} of ${money(sale.total)}?\n(This will restore product stock quantity).`)) return
    setLoading(true)
    const { error } = await supabase.rpc('delete_sale', { p_sale_id: sale.id })
    if (error) { alert('Could not delete: ' + error.message); setLoading(false); return }
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
                        <button className="btn small primary" title="Record Debt Payment" onClick={() => pay(r)}>💳 Pay</button>
                        <button className="btn small" title="Edit Debt Record" onClick={() => editDebt(r)}>✏️ Edit</button>
                        {waUrl && (
                          <a className="btn small whatsapp-btn" href={waUrl} target="_blank" rel="noreferrer" title="Send WhatsApp Reminder">
                            💬 WA
                          </a>
                        )}
                        <button className="btn small red-btn" title="Delete Debt Sale (Restores Stock)" onClick={() => deleteDebt(r)}>🗑️</button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}


