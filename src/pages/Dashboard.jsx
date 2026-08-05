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
  const [debtTotal, setDebtTotal] = useState(0)
  const [loading, setLoading] = useState(true)

  async function load() {
    setLoading(true)
    const start = rangeStart(range)
    let sq = supabase.from('sales').select('business,total,amount_paid,created_at')
    let eq = supabase.from('expenses').select('business,amount,created_at')
    if (start) { sq = sq.gte('created_at', start.toISOString()); eq = eq.gte('created_at', start.toISOString()) }
    const [{ data: s }, { data: e }] = await Promise.all([sq, eq])
    setSales(s || []); setExpenses(e || [])

    // outstanding debts are cumulative (all time)
    const { data: all } = await supabase.from('sales').select('total,amount_paid')
    setDebtTotal((all || []).reduce((sum, r) => sum + Math.max(0, Number(r.total) - Number(r.amount_paid)), 0))
    setLoading(false)
  }
  useEffect(() => { load() }, [range])

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
    const headers = ['Business', 'Total', 'Amount Paid', 'Debt', 'Date']
    const csvRows = [headers.join(',')]
    sales.forEach(s => {
      csvRows.push([
        `"${s.business}"`,
        s.total,
        s.amount_paid,
        Math.max(0, s.total - s.amount_paid),
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

          <h3>By business</h3>
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
