import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../supabaseClient'
import { BUSINESSES, businessOf } from '../lib/businesses'
import { money, rangeStart } from '../lib/format'
import {
  BarChart, Bar, Cell, XAxis, YAxis, Tooltip, ResponsiveContainer,
  LineChart, Line, CartesianGrid,
} from 'recharts'

export default function Dashboard() {
  const [range, setRange] = useState('today')
  const [sales, setSales] = useState([])
  const [expenses, setExpenses] = useState([])
  const [products, setProducts] = useState([])
  const [payments, setPayments] = useState([])
  const [adjustments, setAdjustments] = useState([])
  const [debtTotal, setDebtTotal] = useState(0)
  const [loading, setLoading] = useState(true)

  async function load() {
    setLoading(true)
    const start = rangeStart(range)
    let sq = supabase.from('sales').select('id,business,total,amount_paid,payment_method,created_at,seller,customers(name)').order('created_at', { ascending: false })
    let eq = supabase.from('expenses').select('business,amount,created_at')
    if (start) { sq = sq.gte('created_at', start.toISOString()); eq = eq.gte('created_at', start.toISOString()) }

    const [{ data: s }, { data: e }, { data: p }, { data: pay }, { data: adj }] = await Promise.all([
      sq, 
      eq,
      supabase.from('products').select('*').eq('active', true),
      supabase.from('payments').select('amount,payment_method,created_at'),
      supabase.from('balance_adjustments').select('amount,payment_method,reason,created_at')
    ])

    setSales(s || [])
    setExpenses(e || [])
    setProducts(p || [])
    setPayments(pay || [])
    setAdjustments(adj || [])

    // outstanding debts are cumulative (all time)
    const { data: all } = await supabase.from('sales').select('total,amount_paid')
    setDebtTotal((all || []).reduce((sum, r) => sum + Math.max(0, Number(r.total) - Number(r.amount_paid)), 0))
    setLoading(false)
  }
  useEffect(() => { load() }, [range])

  async function deleteSaleTransaction(sale) {
    if (!confirm(`Cancel/Delete sale receipt #${sale.id.slice(0, 8)} of ${money(sale.total)}?\n(This will restore product stock quantity).`)) return
    setLoading(true)
    const { error } = await supabase.rpc('delete_sale', { p_sale_id: sale.id })
    if (error) { alert('Could not delete: ' + error.message); setLoading(false); return }
    load()
  }

  async function editSalePayment(sale) {
    const input = prompt(`Update amount paid for sale #${sale.id.slice(0, 8)} (Total: ${money(sale.total)}):`, sale.amount_paid)
    if (input == null) return
    const newPaid = Number(input)
    if (isNaN(newPaid) || newPaid < 0) return
    const { error } = await supabase.from('sales').update({ amount_paid: newPaid }).eq('id', sale.id)
    if (error) { alert(error.message); return }
    load()
  }

  async function addBalanceAdjustment() {
    const methodChoice = prompt(`Which fund account?\nType 'cash' for Cash in Hand, or 'momo' for Mobile Money:`, 'cash')
    if (!methodChoice) return
    const method = methodChoice.toLowerCase().includes('momo') ? 'momo' : 'cash'

    const amountInput = prompt(`Amount to add/adjust for ${method === 'momo' ? 'Mobile Money' : 'Cash in Hand'}?\n(Use negative value like -5000 to subtract):`, '10000')
    if (!amountInput) return
    const amt = Number(amountInput)
    if (isNaN(amt) || amt === 0) return

    const reason = prompt('Reason for adjustment / float deposit (optional)?', 'Float deposit') || 'Manual adjustment'

    const { error } = await supabase.from('balance_adjustments').insert({
      payment_method: method,
      amount: amt,
      reason,
    })

    if (error) { alert(error.message); return }
    load()
  }

  // Stock Inventory Valuation Calculations
  const stockValuation = useMemo(() => {
    let grandTotal = 0
    const byBiz = { books: 0, tofu: 0, cantine: 0 }

    products.forEach(p => {
      const val = Math.max(0, Number(p.stock) || 0) * Number(p.price_detail || 0)
      grandTotal += val
      if (byBiz[p.business] !== undefined) {
        byBiz[p.business] += val
      }
    })

    return { grandTotal, byBiz }
  }, [products])

  // Payment Breakdown (Cash vs MoMo)
  const cashVsMomo = useMemo(() => {
    let cash = 0
    let momo = 0

    sales.forEach(s => {
      const paid = Number(s.amount_paid) || 0
      if ((s.payment_method || 'cash') === 'momo') momo += paid
      else cash += paid
    })

    payments.forEach(p => {
      const amt = Number(p.amount) || 0
      if ((p.payment_method || 'cash') === 'momo') momo += amt
      else cash += amt
    })

    adjustments.forEach(a => {
      const amt = Number(a.amount) || 0
      if ((a.payment_method || 'cash') === 'momo') momo += amt
      else cash += amt
    })

    return { cash, momo }
  }, [sales, payments, adjustments])

  const perBiz = useMemo(() => {
    return BUSINESSES.map(b => {
      const revenue = sales.filter(s => s.business === b.key).reduce((a, s) => a + Number(s.total), 0)
      const exp = expenses.filter(x => x.business === b.key).reduce((a, x) => a + Number(x.amount), 0)
      return { key: b.key, label: b.label, color: b.color, revenue, expenses: exp, profit: revenue - exp }
    })
  }, [sales, expenses])

  const overall = useMemo(() => {
    const revenue = sales.reduce((a, s) => a + Number(s.total), 0)
    const exp = expenses.reduce((a, x) => a + Number(x.amount), 0)   // includes shared (null business)
    return { revenue, expenses: exp, profit: revenue - exp }
  }, [sales, expenses])

  const daily = useMemo(() => {
    const map = {}
    sales.forEach(s => {
      const d = new Date(s.created_at).toLocaleDateString()
      map[d] = (map[d] || 0) + Number(s.total)
    })
    return Object.entries(map).map(([date, revenue]) => ({ date, revenue }))
  }, [sales])

  function exportSalesCSV() {
    if (sales.length === 0) return
    const headers = ['Business', 'Customer', 'Total', 'Amount Paid', 'Payment Method', 'Debt', 'Seller', 'Date']
    const csvRows = [headers.join(',')]
    sales.forEach(s => {
      csvRows.push([
        `"${s.business}"`,
        `"${s.customers?.name || 'Walk-in'}"`,
        s.total,
        s.amount_paid,
        `"${s.payment_method || 'cash'}"`,
        Math.max(0, s.total - s.amount_paid),
        `"${s.seller || ''}"`,
        `"${new Date(s.created_at).toLocaleString()}"`
      ].join(','))
    })
    const blob = new Blob([csvRows.join('\n')], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = `Sales_${range}_${new Date().toISOString().slice(0,10)}.csv`
    a.click()
  }

  return (
    <div className="page">
      <div className="header-row">
        <h2>Reports & Analytics</h2>
        {sales.length > 0 && (
          <button className="btn small ghost" onClick={exportSalesCSV}>📥 Export Sales CSV</button>
        )}
      </div>

      <div className="segmented wrap">
        {['today', 'week', 'month', 'all'].map(r => (
          <button key={r} className={range === r ? 'active' : ''} onClick={() => setRange(r)}>{r}</button>
        ))}
      </div>

      {loading ? <p className="muted">Loading…</p> : (
        <>
          <div className="cards">
            <Stat label="Revenue" value={overall.revenue} tone="blue" />
            <Stat label="Expenses" value={overall.expenses} tone="red" />
            <Stat label="Profit" value={overall.profit} tone={overall.profit >= 0 ? 'green' : 'red'} />
            <Stat label="Owed to us" value={debtTotal} tone="amber" />
          </div>

          {/* Cash vs MoMo Balances */}
          <div className="header-row" style={{ marginTop: '12px' }}>
            <h3>Money Balances (Cash & MoMo)</h3>
            <button className="btn small primary" onClick={addBalanceAdjustment}>+ Add / Adjust Funds</button>
          </div>
          <div className="cards">
            <Stat label="💵 Cash in Hand" value={cashVsMomo.cash} tone="green" />
            <Stat label="📱 MoMo (Mobile Money)" value={cashVsMomo.momo} tone="blue" />
          </div>

          {/* Total Stock Valuation Section */}
          <h3>Total Inventory Stock Value</h3>
          <div className="card stock-val-card">
            <div className="stock-val-header">
              <span>Overall Stock Value</span>
              <strong className="stock-val-total">{money(stockValuation.grandTotal)}</strong>
            </div>
            <hr />
            <div className="bizcards">
              {BUSINESSES.map(b => (
                <div className="kv" key={b.key}>
                  <span>{b.label} Stock Value:</span>
                  <strong>{money(stockValuation.byBiz[b.key] || 0)}</strong>
                </div>
              ))}
            </div>
          </div>

          <h3>By business performance</h3>
          <div className="bizcards">
            {perBiz.map(b => (
              <div className="bizcard" key={b.key} style={{ borderTopColor: b.color }}>
                <div className="strong">{b.label}</div>
                <div className="kv"><span>Revenue</span><b>{money(b.revenue)}</b></div>
                <div className="kv"><span>Expenses</span><b>{money(b.expenses)}</b></div>
                <div className="kv"><span>Profit</span><b className={b.profit >= 0 ? 'pos' : 'neg'}>{money(b.profit)}</b></div>
              </div>
            ))}
          </div>

          <h3>Revenue by business</h3>
          <div className="chart">
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={perBiz}>
                <XAxis dataKey="label" /><YAxis /><Tooltip formatter={(v) => money(v)} />
                <Bar dataKey="revenue">
                  {perBiz.map(b => <Cell key={b.key} fill={b.color} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>

          <h3>Daily revenue</h3>
          <div className="chart">
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={daily}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="date" /><YAxis /><Tooltip formatter={(v) => money(v)} />
                <Line type="monotone" dataKey="revenue" stroke="#2563eb" strokeWidth={2} />
              </LineChart>
            </ResponsiveContainer>
          </div>

          <h3>Sales Transactions Table</h3>
          <div className="table-responsive card">
            {sales.length === 0 ? (
              <p className="muted">No sales transactions in this period.</p>
            ) : (
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Date & Time</th>
                    <th>Business</th>
                    <th>Customer</th>
                    <th>Payment Method</th>
                    <th>Total</th>
                    <th>Paid</th>
                    <th>Debt Status</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {sales.map(s => {
                    const debt = Math.max(0, s.total - s.amount_paid)
                    return (
                      <tr key={s.id}>
                        <td className="small muted">{new Date(s.created_at).toLocaleString()}</td>
                        <td><span className="pill-badge">{s.business}</span></td>
                        <td className="strong">{s.customers?.name || 'Walk-in'}</td>
                        <td>
                          <span className={`method-badge ${s.payment_method === 'momo' ? 'momo' : 'cash'}`}>
                            {s.payment_method === 'momo' ? '📱 MoMo' : '💵 Cash'}
                          </span>
                        </td>
                        <td className="strong">{money(s.total)}</td>
                        <td>{money(s.amount_paid)}</td>
                        <td>
                          {debt > 0 ? (
                            <span className="badge owe">Owes {money(debt)}</span>
                          ) : (
                            <span className="badge instock">Fully Paid</span>
                          )}
                        </td>
                        <td>
                          <div className="actions-cell">
                            <button className="btn small" title="Edit Amount Paid" onClick={() => editSalePayment(s)}>✏️ Edit</button>
                            <button className="btn small red-btn" title="Delete/Cancel Sale (Restores Stock)" onClick={() => deleteSaleTransaction(s)}>🗑️ Delete</button>
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}
    </div>
  )
}

function Stat({ label, value, tone }) {
  return (
    <div className={'stat ' + tone}>
      <div className="stat-label">{label}</div>
      <div className="stat-value">{money(value)}</div>
    </div>
  )
}

