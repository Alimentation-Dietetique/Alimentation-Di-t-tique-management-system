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
  const [allSalesData, setAllSalesData] = useState([])
  const [allPaymentsData, setAllPaymentsData] = useState([])
  const [allExpensesData, setAllExpensesData] = useState([])
  const [salesSearch, setSalesSearch] = useState('')
  const [debtTotal, setDebtTotal] = useState(0)
  const [loading, setLoading] = useState(true)

  async function load() {
    setLoading(true)
    const start = rangeStart(range)
    let sq = supabase.from('sales').select('*').order('created_at', { ascending: false })
    let eq = supabase.from('expenses').select('*')
    if (start) { 
      sq = sq.gte('created_at', start.toISOString())
      eq = eq.gte('created_at', start.toISOString()) 
    }

    const [
      { data: s, error: sErr }, 
      { data: e, error: eErr }, 
      { data: p }, 
      { data: pay }, 
      { data: adj }, 
      { data: allSales }, 
      { data: allPay },
      { data: custs },
      { data: allExp }
    ] = await Promise.all([
      sq, 
      eq,
      supabase.from('products').select('*').eq('active', true),
      supabase.from('payments').select('*'),
      supabase.from('balance_adjustments').select('*'),
      supabase.from('sales').select('total,amount_paid,payment_method'),
      supabase.from('payments').select('amount,payment_method'),
      supabase.from('customers').select('id,name,phone'),
      supabase.from('expenses').select('*'),
    ])

    if (sErr) console.error('Error loading sales:', sErr)
    if (eErr) console.error('Error loading expenses:', eErr)

    const custMap = new Map((custs || []).map(c => [c.id, c]))
    const salesWithCust = (s || []).map(item => ({
      ...item,
      customers: item.customer_id ? custMap.get(item.customer_id) : null
    }))

    setSales(salesWithCust)
    setExpenses(e || [])
    setProducts(p || [])
    setPayments(pay || [])
    setAdjustments(adj || [])
    setAllSalesData(allSales || [])
    setAllPaymentsData(allPay || [])
    setAllExpensesData(allExp || [])

    // outstanding debts are cumulative (all time)
    const { data: all } = await supabase.from('sales').select('total,amount_paid')
    setDebtTotal((all || []).reduce((sum, r) => sum + Math.max(0, Number(r.total) - Number(r.amount_paid)), 0))
    setLoading(false)
  }
  useEffect(() => { load() }, [range])

  const filteredSales = useMemo(() => {
    if (!salesSearch.trim()) return sales
    const q = salesSearch.toLowerCase()
    return sales.filter(s => 
      (s.customers?.name || '').toLowerCase().includes(q) || 
      (s.business || '').toLowerCase().includes(q) || 
      (s.payment_method || 'cash').toLowerCase().includes(q) || 
      (s.seller || '').toLowerCase().includes(q)
    )
  }, [sales, salesSearch])


  const [deletingSale, setDeletingSale] = useState(null)
  const [editingSale, setEditingSale] = useState(null)
  const [editPaidInput, setEditPaidInput] = useState('')

  const [viewingSale, setViewingSale] = useState(null)
  const [saleDetailsItems, setSaleDetailsItems] = useState([])
  const [loadingDetails, setLoadingDetails] = useState(false)

  async function openSaleDetails(sale) {
    setViewingSale(sale)
    setLoadingDetails(true)
    const { data: items } = await supabase.from('sale_items').select('*').eq('sale_id', sale.id)
    setSaleDetailsItems(items || [])
    setLoadingDetails(false)
  }

  const [fundModal, setFundModal] = useState(null) // 'cash' | 'momo' | null
  const [fundForm, setFundForm] = useState({ amount: '', reason: 'Float deposit' })
  const [saving, setSaving] = useState(false)

  async function confirmDeleteSale() {
    if (!deletingSale) return
    setSaving(true)

    try {
      // 1. Fetch sale items to restore product stock
      const { data: items } = await supabase
        .from('sale_items')
        .select('product_id, quantity')
        .eq('sale_id', deletingSale.id)

      if (items && items.length) {
        for (const item of items) {
          if (item.product_id) {
            const { data: prod } = await supabase
              .from('products')
              .select('stock, track_stock')
              .eq('id', item.product_id)
              .single()

            if (prod && prod.track_stock) {
              const newStock = Number(prod.stock || 0) + Number(item.quantity || 0)
              await supabase.from('products').update({ stock: newStock }).eq('id', item.product_id)
            }
          }
        }
      }

      // 2. Delete the sale record
      const { error } = await supabase.from('sales').delete().eq('id', deletingSale.id)
      if (error) {
        alert('Could not delete transaction: ' + error.message)
        setSaving(false)
        return
      }

      setDeletingSale(null)
      load()
    } catch (err) {
      alert('Error deleting transaction: ' + err.message)
    } finally {
      setSaving(false)
    }
  }

  function startEditSale(sale) {
    setEditingSale(sale)
    setEditPaidInput(sale.amount_paid ?? '')
  }

  async function saveEditSale() {
    if (!editingSale) return
    const newPaid = Number(editPaidInput)
    if (isNaN(newPaid) || newPaid < 0) {
      alert('Please enter a valid amount paid.')
      return
    }

    setSaving(true)
    const { error } = await supabase.from('sales').update({ amount_paid: newPaid }).eq('id', editingSale.id)
    setSaving(false)
    if (error) { alert(error.message); return }

    setEditingSale(null)
    load()
  }

  async function saveFundDeposit() {
    if (!fundModal) return
    const amt = Number(fundForm.amount)
    if (!amt || isNaN(amt)) return

    setSaving(true)
    const { error } = await supabase.from('balance_adjustments').insert({
      payment_method: fundModal,
      amount: amt,
      reason: fundForm.reason || 'Manual deposit',
    })
    setSaving(false)
    if (error) { alert(error.message); return }

    setFundModal(null)
    setFundForm({ amount: '', reason: 'Float deposit' })
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

  // Payment Breakdown (All-time Cash vs MoMo)
  const cashVsMomo = useMemo(() => {
    let cash = 0
    let momo = 0

    allSalesData.forEach(s => {
      const paid = Number(s.amount_paid) || 0
      if ((s.payment_method || 'cash') === 'momo') momo += paid
      else cash += paid
    })

    allPaymentsData.forEach(p => {
      const amt = Number(p.amount) || 0
      if ((p.payment_method || 'cash') === 'momo') momo += amt
      else cash += amt
    })

    adjustments.forEach(a => {
      const amt = Number(a.amount) || 0
      if ((a.payment_method || 'cash') === 'momo') momo += amt
      else cash += amt
    })

    allExpensesData.forEach(e => {
      const amt = Number(e.amount) || 0
      if ((e.payment_method || 'cash') === 'momo') momo -= amt
      else cash -= amt
    })

    return { cash, momo }
  }, [allSalesData, allPaymentsData, adjustments, allExpensesData])

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
          <div className="header-row" style={{ marginTop: '16px' }}>
            <h3>Money Balances (Cash & MoMo)</h3>
          </div>
          <div className="cards">
            <div className="stat green">
              <div className="stat-label">💵 Cash in Hand</div>
              <div className="stat-value">{money(cashVsMomo.cash)}</div>
              <button className="btn small primary" style={{ marginTop: '8px', width: '100%' }} onClick={() => setFundModal('cash')}>
                💵 + Add Money to Cash
              </button>
            </div>

            <div className="stat blue">
              <div className="stat-label">📱 MoMo (Mobile Money)</div>
              <div className="stat-value">{money(cashVsMomo.momo)}</div>
              <button className="btn small primary" style={{ marginTop: '8px', width: '100%' }} onClick={() => setFundModal('momo')}>
                📱 + Add Money to MoMo
              </button>
            </div>
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

          <div className="header-row">
            <h3>Sales Transactions Table</h3>
          </div>

          <input 
            type="text" 
            placeholder="🔍 Search sales by customer name, business, payment method or seller..." 
            value={salesSearch} 
            onChange={e => setSalesSearch(e.target.value)} 
            className="searchinput"
          />

          <div className="table-responsive card">
            {filteredSales.length === 0 ? (
              <p className="muted">No matching sales transactions found in this period.</p>
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
                  {filteredSales.map(s => {
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
                            <button className="btn small primary" title="View Transaction Details & Sold Items" onClick={() => openSaleDetails(s)}>👁️ View</button>
                            <button className="btn small" title="Edit Amount Paid" onClick={() => startEditSale(s)}>✏️ Edit</button>
                            <button className="btn small red-btn" title="Delete/Cancel Sale (Restores Stock)" onClick={() => setDeletingSale(s)}>🗑️</button>
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

      {/* Modal: View Transaction Details */}
      {viewingSale && (
        <div className="modal-overlay">
          <div className="modal-content card printable-receipt" style={{ maxWidth: '500px', margin: '0 auto' }}>
            <div className="receipt-header">
              <h3>Alimentation Diététique</h3>
              <p><span className="pill-badge">{viewingSale.business}</span> Transaction Receipt</p>
              <small>{new Date(viewingSale.created_at).toLocaleString()}</small>
              <div className="muted small" style={{ marginTop: '4px' }}>Receipt ID: <strong>#{viewingSale.id.slice(0, 8)}</strong></div>
            </div>
            <hr />
            <div className="receipt-meta">
              <div>Customer: <strong>{viewingSale.customers?.name || 'Walk-in'}</strong> {viewingSale.customers?.phone ? `(${viewingSale.customers.phone})` : ''}</div>
              <div>Seller: <strong>{viewingSale.seller || 'Cashier'}</strong></div>
              <div>Payment Method: <strong>{viewingSale.payment_method === 'momo' ? '📱 Mobile Money (MoMo)' : '💵 Cash'}</strong></div>
            </div>
            <hr />
            <h4 style={{ margin: '8px 0' }}>📦 Sold Items Breakdown</h4>
            {loadingDetails ? (
              <p className="muted small">Loading sold items...</p>
            ) : (
              <div className="table-responsive" style={{ maxHeight: '200px', overflowY: 'auto' }}>
                {saleDetailsItems.length === 0 ? (
                  <p className="muted small">No item breakdown found.</p>
                ) : (
                  <table className="data-table small-table">
                    <thead>
                      <tr>
                        <th>Product</th>
                        <th>Qty</th>
                        <th>Unit Price</th>
                        <th>Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {saleDetailsItems.map((it, idx) => (
                        <tr key={idx}>
                          <td className="strong">{it.product_name || 'Item'}</td>
                          <td>{it.quantity}</td>
                          <td>{money(it.unit_price)}</td>
                          <td className="strong">{money(it.line_total)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            )}
            <hr />
            <div className="receipt-totals">
              <div className="kv"><span>Total Sale Amount:</span><strong>{money(viewingSale.total)}</strong></div>
              <div className="kv"><span>Amount Paid:</span><span>{money(viewingSale.amount_paid)}</span></div>
              {Number(viewingSale.total) - Number(viewingSale.amount_paid) > 0 ? (
                <div className="kv debt-text"><span>Outstanding Debt:</span><strong>{money(Number(viewingSale.total) - Number(viewingSale.amount_paid))}</strong></div>
              ) : (
                <div className="kv change-text"><span>Status:</span><strong>Fully Paid ✓</strong></div>
              )}
            </div>
            <div className="modal-actions" style={{ marginTop: '16px' }}>
              <button className="btn primary" onClick={() => window.print()}>🖨️ Print Receipt</button>
              <button className="btn ghost" onClick={() => { setViewingSale(null); setSaleDetailsItems([]); }}>Close</button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Edit Sale Amount Paid */}
      {editingSale && (
        <div className="modal-overlay">
          <div className="modal-content card" style={{ maxWidth: '400px', margin: '0 auto' }}>
            <h3>✏️ Edit Amount Paid</h3>
            <p className="small muted">Sale Receipt #{editingSale.id.slice(0, 8)} · Total: <strong>{money(editingSale.total)}</strong></p>

            <label>Amount Paid</label>
            <input 
              type="number" 
              step="any" 
              value={editPaidInput} 
              onChange={e => setEditPaidInput(e.target.value)} 
              placeholder="Enter amount..." 
            />

            <div className="modal-actions" style={{ marginTop: '16px' }}>
              <button className="btn primary" disabled={saving} onClick={saveEditSale}>
                {saving ? 'Saving...' : 'Save Changes'}
              </button>
              <button className="btn ghost" onClick={() => setEditingSale(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Delete Sale Confirmation */}
      {deletingSale && (
        <div className="modal-overlay">
          <div className="modal-content card" style={{ maxWidth: '400px', margin: '0 auto' }}>
            <h3 style={{ color: 'var(--red)' }}>🗑️ Cancel & Delete Sale?</h3>
            <p className="small">Are you sure you want to delete sale receipt <strong>#{deletingSale.id.slice(0, 8)}</strong> ({money(deletingSale.total)})?</p>
            <p className="small muted">This action will automatically restore product stock quantity.</p>

            <div className="modal-actions" style={{ marginTop: '16px' }}>
              <button className="btn red-btn" disabled={saving} onClick={confirmDeleteSale}>
                {saving ? 'Deleting...' : 'Yes, Delete & Restore Stock'}
              </button>
              <button className="btn ghost" onClick={() => setDeletingSale(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Deposit Fund */}
      {fundModal && (
        <div className="modal-overlay">
          <div className="modal-content card" style={{ maxWidth: '400px', margin: '0 auto' }}>
            <h3>{fundModal === 'momo' ? '📱 Add Money to MoMo' : '💵 Add Money to Cash in Hand'}</h3>
            <label>Amount to Deposit / Adjust</label>
            <input 
              type="number" 
              step="any" 
              value={fundForm.amount} 
              onChange={e => setFundForm({ ...fundForm, amount: e.target.value })} 
              placeholder="Enter amount..." 
            />

            <label>Reason / Note (optional)</label>
            <input 
              type="text" 
              value={fundForm.reason} 
              onChange={e => setFundForm({ ...fundForm, reason: e.target.value })} 
              placeholder="e.g. Float deposit, Cash additions" 
            />

            <div className="modal-actions" style={{ marginTop: '16px' }}>
              <button className="btn primary" disabled={saving || !fundForm.amount} onClick={saveFundDeposit}>
                {saving ? 'Saving...' : 'Confirm Deposit'}
              </button>
              <button className="btn ghost" onClick={() => setFundModal(null)}>Cancel</button>
            </div>
          </div>
        </div>
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

