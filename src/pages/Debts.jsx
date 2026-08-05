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
    return rows.filter(r => (r.customers?.name || '').toLowerCase().includes(f) || r.business.toLowerCase().includes(f))
  }, [rows, filter])

  const totalOwed = rows.reduce((s, r) => s + r.outstanding, 0)

  return (
    <div className="page">
      <div className="header-row">
        <h2>Debts <span className="pill">{money(totalOwed)}</span></h2>
        {rows.length > 0 && (
          <button className="btn small ghost" onClick={exportCSV}>📥 Export CSV</button>
        )}
      </div>

      <input 
        type="text" 
        placeholder="🔍 Filter customer or business..." 
        value={filter} 
        onChange={e => setFilter(e.target.value)}
        className="searchinput"
      />

      {loading && <p className="muted">Loading…</p>}
      {!loading && filteredRows.length === 0 && <p className="muted">No outstanding debts 🎉</p>}
      <div className="list">
        {filteredRows.map(r => {
          const waUrl = getWhatsAppUrl(r)
          return (
            <div className="listrow" key={r.id}>
              <div>
                <div className="strong">{r.customers?.name || 'Walk-in'}</div>
                <div className="muted small">
                  {r.business} · {new Date(r.created_at).toLocaleDateString()}
                  {r.customers?.phone ? ` · ${r.customers.phone}` : ''}
                </div>
              </div>
              <div className="right">
                <div className="strong owe">{money(r.outstanding)}</div>
                <div className="muted small">of {money(r.total)}</div>
              </div>
              <div className="actions-cell">
                {waUrl && (
                  <a className="btn small whatsapp-btn" href={waUrl} target="_blank" rel="noreferrer" title="Send WhatsApp Reminder">
                    💬 WA
                  </a>
                )}
                <button className="btn small primary" onClick={() => pay(r)}>Pay</button>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

