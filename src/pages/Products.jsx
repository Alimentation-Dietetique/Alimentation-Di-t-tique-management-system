import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../supabaseClient'
import { BUSINESSES, businessOf } from '../lib/businesses'
import { money, num } from '../lib/format'

const blank = { name: '', unit: 'piece', price_detail: '', price_supply: '', stock: '', track_stock: true, tiers: '' }

export default function Products() {
  const [business, setBusiness] = useState('cantine')
  const [products, setProducts] = useState([])
  const [form, setForm] = useState(blank)
  const [editingId, setEditingId] = useState(null)
  const [tableSearch, setTableSearch] = useState('')
  const [busy, setBusy] = useState(false)
  const biz = businessOf(business)

  async function load() {
    const { data } = await supabase.from('products').select('*').eq('business', business).order('name')
    setProducts(data || [])
  }
  useEffect(() => { 
    load()
    setEditingId(null)
    setTableSearch('')
    setForm({ ...blank, unit: biz.unit }) 
  }, [business])

  const filteredProducts = useMemo(() => {
    if (!tableSearch.trim()) return products
    const q = tableSearch.toLowerCase()
    return products.filter(p => p.name.toLowerCase().includes(q) || (p.unit || '').toLowerCase().includes(q))
  }, [products, tableSearch])

  function startEdit(p) {
    setEditingId(p.id)
    setForm({
      name: p.name,
      unit: p.unit || biz.unit,
      price_detail: p.price_detail ?? '',
      price_supply: p.price_supply ?? '',
      stock: p.stock ?? 0,
      track_stock: p.track_stock,
      tiers: p.price_tiers ? JSON.stringify(p.price_tiers) : '',
    })
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  function cancelEdit() {
    setEditingId(null)
    setForm({ ...blank, unit: biz.unit })
  }

  async function save() {
    if (!form.name) return
    let price_tiers = null
    if (form.tiers.trim()) {
      try { price_tiers = JSON.parse(form.tiers) } catch { alert('Tiers must be valid JSON'); return }
    }
    setBusy(true)
    const payload = {
      business, name: form.name, unit: form.unit,
      price_detail: Number(form.price_detail) || 0,
      price_supply: biz.hasSupply && form.price_supply !== '' ? Number(form.price_supply) : null,
      price_tiers,
      track_stock: form.track_stock,
      stock: Number(form.stock) || 0,
    }

    let res
    if (editingId) {
      res = await supabase.from('products').update(payload).eq('id', editingId)
    } else {
      res = await supabase.from('products').insert(payload)
    }

    setBusy(false)
    if (res.error) { alert(res.error.message); return }
    cancelEdit()
    load()
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

  async function deleteProduct(p) {
    if (!confirm(`Are you sure you want to delete "${p.name}"?`)) return
    const { error } = await supabase.from('products').delete().eq('id', p.id)
    if (error) { alert(error.message); return }
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
        <h3>{editingId ? 'Edit Product' : 'Add New Product'}</h3>
        <label>Product name</label>
        <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="e.g. Tofu 1kg / Book Title" />
        <div className="row2">
          <div>
            <label>Unit</label>
            <input value={form.unit} onChange={e => setForm({ ...form, unit: e.target.value })} />
          </div>
          <div>
            <label>Stock Quantity</label>
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
        <div className="payrow">
          <button className="btn primary" disabled={busy} onClick={save}>
            {editingId ? 'Save Changes' : 'Add product'}
          </button>
          {editingId && (
            <button className="btn ghost" onClick={cancelEdit}>Cancel</button>
          )}
        </div>
      </div>

      <div className="header-row">
        <h3>{biz.label} Product Table</h3>
      </div>
      
      <input 
        type="text" 
        placeholder={`🔍 Search ${biz.label} stock table by name or unit...`} 
        value={tableSearch} 
        onChange={e => setTableSearch(e.target.value)} 
        className="searchinput"
      />

      <div className="table-responsive card">
        {filteredProducts.length === 0 ? (
          <p className="muted">No matching products found for {biz.label}.</p>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Product Name</th>
                <th>Unit</th>
                <th>Detail Price</th>
                {biz.hasSupply && <th>Supply Price</th>}
                <th>Current Stock</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredProducts.map(p => {
                const isOutOfStock = p.track_stock && p.stock <= 0
                const isLowStock = p.track_stock && p.stock > 0 && p.stock <= 5
                return (
                  <tr key={p.id} style={{ opacity: p.active ? 1 : 0.5 }}>
                    <td className="strong">{p.name}</td>
                    <td>{p.unit}</td>
                    <td>{money(p.price_detail)}</td>
                    {biz.hasSupply && <td>{p.price_supply != null ? money(p.price_supply) : '—'}</td>}
                    <td>
                      {!p.track_stock ? (
                        <span className="muted">Not tracked</span>
                      ) : isOutOfStock ? (
                        <span className="badge outofstock">0 (Out of stock)</span>
                      ) : isLowStock ? (
                        <span className="badge lowstock">{num(p.stock)} {p.unit}</span>
                      ) : (
                        <span className="badge instock">{num(p.stock)} {p.unit}</span>
                      )}
                    </td>
                    <td>
                      <span className={`status-pill ${p.active ? 'active' : 'hidden'}`}>
                        {p.active ? 'Active' : 'Hidden'}
                      </span>
                    </td>
                    <td>
                      <div className="actions-cell">
                        <button className="btn small" title="Edit Product" onClick={() => startEdit(p)}>✏️ Edit</button>
                        <button className="btn small ghost" title="Restock" onClick={() => restock(p)}>+ Stock</button>
                        <button className="btn small ghost" title="Toggle Visibility" onClick={() => toggleActive(p)}>{p.active ? 'Hide' : 'Show'}</button>
                        <button className="btn small red-btn" title="Delete Product" onClick={() => deleteProduct(p)}>🗑️</button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}



