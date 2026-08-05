import { useEffect, useState } from 'react'
import { supabase } from '../supabaseClient'
import { BUSINESSES, businessOf } from '../lib/businesses'
import { money, num } from '../lib/format'

const blank = { name: '', unit: 'piece', price_detail: '', price_supply: '', stock: '', track_stock: true, tiers: '' }

export default function Products() {
  const [business, setBusiness] = useState('cantine')
  const [products, setProducts] = useState([])
  const [form, setForm] = useState(blank)
  const [busy, setBusy] = useState(false)
  const biz = businessOf(business)

  async function load() {
    const { data } = await supabase.from('products').select('*').eq('business', business).order('name')
    setProducts(data || [])
  }
  useEffect(() => { load(); setForm({ ...blank, unit: biz.unit }) }, [business])

  async function add() {
    if (!form.name) return
    let price_tiers = null
    if (form.tiers.trim()) {
      try { price_tiers = JSON.parse(form.tiers) } catch { alert('Tiers must be valid JSON'); return }
    }
    setBusy(true)
    const { error } = await supabase.from('products').insert({
      business, name: form.name, unit: form.unit,
      price_detail: Number(form.price_detail) || 0,
      price_supply: biz.hasSupply && form.price_supply !== '' ? Number(form.price_supply) : null,
      price_tiers,
      track_stock: form.track_stock,
      stock: Number(form.stock) || 0,
    })
    setBusy(false)
    if (error) { alert(error.message); return }
    setForm({ ...blank, unit: biz.unit }); load()
  }

  async function restock(p) {
    const qty = Number(prompt(`Add stock to "${p.name}" (current ${num(p.stock)} ${p.unit})`, ''))
    if (!qty) return
    const { error } = await supabase.rpc('restock_product', { p_product_id: p.id, p_qty: qty })
    if (error) { alert(error.message); return }
    load()
  }

  async function toggleActive(p) {
    await supabase.from('products').update({ active: !p.active }).eq('id', p.id)
    load()
  }

  return (
    <div className="page">
      <h2>Stock & products</h2>
      <div className="tabs">
        {BUSINESSES.map(b => (
          <button key={b.key} className={'tab' + (b.key === business ? ' active' : '')}
            style={b.key === business ? { background: b.color } : {}}
            onClick={() => setBusiness(b.key)}>{b.label}</button>
        ))}
      </div>

      <div className="card">
        <label>Product name</label>
        <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
        <div className="row2">
          <div>
            <label>Unit</label>
            <input value={form.unit} onChange={e => setForm({ ...form, unit: e.target.value })} />
          </div>
          <div>
            <label>Initial stock</label>
            <input type="number" step="any" value={form.stock} onChange={e => setForm({ ...form, stock: e.target.value })} />
          </div>
        </div>
        <div className="row2">
          <div>
            <label>Detail price</label>
            <input type="number" step="any" value={form.price_detail} onChange={e => setForm({ ...form, price_detail: e.target.value })} />
          </div>
          {biz.hasSupply && (
            <div>
              <label>Supply price</label>
              <input type="number" step="any" value={form.price_supply} onChange={e => setForm({ ...form, price_supply: e.target.value })} />
            </div>
          )}
        </div>
        {business === 'tofu' && (
          <>
            <label>Weight tiers (optional JSON)</label>
            <textarea rows="3" value={form.tiers} onChange={e => setForm({ ...form, tiers: e.target.value })}
              placeholder='[{"label":"1kg","qty":1,"detail":1500,"supply":1300},{"label":"1/2kg","qty":0.5,"detail":800,"supply":700}]' />
          </>
        )}
        <label className="checkbox">
          <input type="checkbox" checked={form.track_stock} onChange={e => setForm({ ...form, track_stock: e.target.checked })} />
          Track stock for this product
        </label>
        <button className="btn primary" disabled={busy} onClick={add}>Add product</button>
      </div>

      <div className="list">
        {products.map(p => (
          <div className="listrow" key={p.id} style={{ opacity: p.active ? 1 : 0.5 }}>
            <div>
              <div className="strong">{p.name}</div>
              <div className="muted small">
                {money(p.price_detail)}{p.price_supply != null ? ` / ${money(p.price_supply)}` : ''} · {p.unit}
                {p.track_stock ? ` · stock ${num(p.stock)}` : ' · not tracked'}
              </div>
            </div>
            <button className="btn small" onClick={() => restock(p)}>+ Stock</button>
            <button className="btn small ghost" onClick={() => toggleActive(p)}>{p.active ? 'Hide' : 'Show'}</button>
          </div>
        ))}
      </div>
    </div>
  )
}
