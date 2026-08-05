import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../supabaseClient'
import { BUSINESSES, businessOf } from '../lib/businesses'
import { money, num } from '../lib/format'

export default function Sell({ seller }) {
  const [business, setBusiness] = useState('cantine')      // cantine first: highest frequency
  const [priceType, setPriceType] = useState('detail')
  const [products, setProducts] = useState([])
  const [cart, setCart] = useState([])
  const [customers, setCustomers] = useState([])
  const [customerId, setCustomerId] = useState('')
  const [paidMode, setPaidMode] = useState('full')          // 'full' | 'credit'
  const [amountPaid, setAmountPaid] = useState('')
  const [cashTendered, setCashTendered] = useState('')
  const [search, setSearch] = useState('')
  const [saving, setSaving] = useState(false)
  const [flash, setFlash] = useState('')
  const [lastReceipt, setLastReceipt] = useState(null)

  const biz = businessOf(business)

  async function loadProducts() {
    const { data } = await supabase.from('products')
      .select('*').eq('business', business).eq('active', true).order('name')
    setProducts(data || [])
  }
  async function loadCustomers() {
    const { data } = await supabase.from('customers').select('id,name,phone').order('name')
    setCustomers(data || [])
  }
  useEffect(() => { loadProducts(); setCart([]) }, [business])
  useEffect(() => { loadCustomers() }, [])
  useEffect(() => { if (!biz.hasSupply) setPriceType('detail') }, [business])

  function priceFor(p, tier) {
    if (tier) return priceType === 'supply' ? (tier.supply ?? tier.detail) : tier.detail
    return priceType === 'supply' ? (p.price_supply ?? p.price_detail) : p.price_detail
  }

  function addLine(p, tier) {
    if (p.track_stock && p.stock <= 0) {
      alert(`"${p.name}" is out of stock! Cannot sell this item.`)
      return
    }
    const qty = tier ? Number(tier.qty) : 1
    const unit = tier ? priceFor(p, tier) / qty : priceFor(p, null)

    // Check existing cart quantity for this product
    const existingInCart = cart
      .filter(l => l.product_id === p.id)
      .reduce((sum, l) => sum + l.quantity, 0)

    if (p.track_stock && (existingInCart + qty) > p.stock) {
      alert(`Cannot add ${qty} ${p.unit}. Only ${p.stock - existingInCart} left in stock for "${p.name}".`)
      return
    }

    setCart(prev => {
      const key = p.id + '|' + unit + '|' + (tier?.label || '')
      const i = prev.findIndex(l => l.key === key)
      if (i >= 0) {
        const next = [...prev]; next[i] = { ...next[i], quantity: next[i].quantity + qty }
        return next
      }
      return [...prev, {
        key, product_id: p.id, product_name: p.name + (tier ? ` (${tier.label})` : ''),
        quantity: qty, unit_price: unit,
      }]
    })
  }

  function setQty(key, q) {
    setCart(prev => prev.map(l => l.key === key ? { ...l, quantity: Math.max(0, Number(q) || 0) } : l))
  }
  function setPrice(key, v) {
    setCart(prev => prev.map(l => l.key === key ? { ...l, unit_price: Math.max(0, Number(v) || 0) } : l))
  }
  function removeLine(key) { setCart(prev => prev.filter(l => l.key !== key)) }

  const total = useMemo(
    () => cart.reduce((s, l) => s + l.quantity * l.unit_price, 0),
    [cart]
  )

  const changeDue = useMemo(() => {
    const tendered = Number(cashTendered) || 0
    return Math.max(0, tendered - total)
  }, [cashTendered, total])

  const filteredProducts = useMemo(() => {
    if (!search.trim()) return products
    const s = search.toLowerCase()
    return products.filter(p => p.name.toLowerCase().includes(s))
  }, [products, search])

  async function quickAddCustomer() {
    const name = prompt('Customer name?')
    if (!name) return
    const phone = prompt('Phone (optional)?') || null
    const { data, error } = await supabase.from('customers').insert({ name, phone }).select().single()
    if (!error && data) { await loadCustomers(); setCustomerId(data.id) }
  }

  async function complete() {
    if (cart.length === 0) return
    if (paidMode === 'credit' && !customerId) { alert('Select a customer for a credit sale.'); return }
    setSaving(true)
    const paid = paidMode === 'full' ? total : (Number(amountPaid) || 0)
    const selectedCust = customers.find(c => c.id === customerId)
    const items = cart.map(l => ({
      product_id: l.product_id, product_name: l.product_name,
      quantity: l.quantity, unit_price: l.unit_price,
      line_total: Math.round(l.quantity * l.unit_price * 100) / 100,
    }))

    const payload = {
      business, price_type: priceType,
      customer_id: customerId || null,
      amount_paid: paid,
      seller,
      items,
    }
    const { data: saleId, error } = await supabase.rpc('create_sale', { payload })
    setSaving(false)
    if (error) { alert('Could not save: ' + error.message); return }

    setLastReceipt({
      id: saleId,
      date: new Date().toLocaleString(),
      businessName: biz.label,
      customerName: selectedCust?.name || 'Walk-in',
      items,
      total,
      paid,
      debt: Math.max(0, total - paid),
      cashTendered: Number(cashTendered) || paid,
      changeDue: paidMode === 'full' && cashTendered ? Math.max(0, Number(cashTendered) - total) : 0,
      seller: seller || 'Seller',
    })

    setCart([]); setCustomerId(''); setPaidMode('full'); setAmountPaid(''); setCashTendered('')
    setFlash('Sale saved ✓'); setTimeout(() => setFlash(''), 1500)
    loadProducts()
  }

  return (
    <div className="sell">
      <div className="tabs">
        {BUSINESSES.map(b => (
          <button key={b.key}
            className={'tab' + (b.key === business ? ' active' : '')}
            style={b.key === business ? { background: b.color } : {}}
            onClick={() => setBusiness(b.key)}>{b.label}</button>
        ))}
      </div>

      {biz.hasSupply && (
        <div className="pricetoggle">
          <button className={priceType === 'detail' ? 'active' : ''} onClick={() => setPriceType('detail')}>Detail price</button>
          <button className={priceType === 'supply' ? 'active' : ''} onClick={() => setPriceType('supply')}>Supply price</button>
        </div>
      )}

      <div className="searchbox">
        <input 
          type="text" 
          placeholder="🔍 Search items..." 
          value={search} 
          onChange={e => setSearch(e.target.value)} 
          className="searchinput"
        />
      </div>

      {/* Cart (Top Prominent Position so sellers see order grow immediately) */}
      <div className="cart-container">
        <div className="cart-header">
          🛒 Current Order {cart.length > 0 ? `(${cart.length} items)` : '(Empty)'}
          <span className="cart-total-badge">{money(total)}</span>
        </div>
        {cart.length === 0 ? (
          <div className="cart-empty-notice">Tap any product below to add it to this sale receipt.</div>
        ) : (
          <div className="cart">
            {cart.map(l => (
              <div className="cartline" key={l.key}>
                <div className="cl-name">{l.product_name}</div>
                <div className="cl-qty-group">
                  <button className="qty-btn" onClick={() => setQty(l.key, Math.max(0, l.quantity - 1))}>-</button>
                  <input className="cl-qty" type="number" step="any" value={l.quantity}
                    onChange={e => setQty(l.key, e.target.value)} />
                  <button className="qty-btn" onClick={() => setQty(l.key, l.quantity + 1)}>+</button>
                </div>
                <span className="times">×</span>
                <input className="cl-price" type="number" step="any" value={l.unit_price}
                  onChange={e => setPrice(l.key, e.target.value)} />
                <div className="cl-total">{money(l.quantity * l.unit_price)}</div>
                <button className="cl-x" onClick={() => removeLine(l.key)}>✕</button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="grid">
        {filteredProducts.length === 0 && <p className="muted">No products found.</p>}
        {filteredProducts.map(p => {
          const tiers = Array.isArray(p.price_tiers) ? p.price_tiers : null
          const isOutOfStock = p.track_stock && p.stock <= 0
          const isLowStock = p.track_stock && p.stock > 0 && p.stock <= 5
          if (tiers && tiers.length) {
            return (
              <div key={p.id} className={`prodcard ${isOutOfStock ? 'disabled-card' : ''}`}>
                <div className="prodname">
                  {p.name} 
                  {isOutOfStock ? <span className="outofstockbadge">Out of Stock</span> : isLowStock ? <span className="lowbadge">Low</span> : null}
                </div>
                <div className="tierrow">
                  {tiers.map((t, i) => (
                    <button key={i} className="tierbtn" disabled={isOutOfStock} onClick={() => addLine(p, t)}>
                      + {t.label}<br /><small>{money(priceFor(p, t))}</small>
                    </button>
                  ))}
                </div>
              </div>
            )
          }
          return (
            <button key={p.id} className={`prodcard tap ${isOutOfStock ? 'disabled-card' : ''}`} disabled={isOutOfStock} onClick={() => addLine(p, null)}>
              <div className="prodname">
                {p.name} 
                {isOutOfStock ? <span className="outofstockbadge">Out of Stock</span> : isLowStock ? <span className="lowbadge">Low</span> : null}
              </div>
              <div className="prodprice">{money(priceFor(p, null))}</div>
              {p.track_stock && (
                <div className={`prodstock ${isOutOfStock ? 'danger' : isLowStock ? 'warn' : ''}`}>
                  {isOutOfStock ? 'Out of stock' : `stock: ${num(p.stock)}`}
                </div>
              )}
            </button>
          )
        })}
      </div>

      {/* Checkout bar */}
      <div className="checkout">
        <div className="payrow">
          <select value={customerId} onChange={e => setCustomerId(e.target.value)}>
            <option value="">Walk-in (no customer)</option>
            {customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <button className="btn ghost" onClick={quickAddCustomer}>+ Customer</button>
        </div>
        <div className="payrow">
          <div className="segmented">
            <button className={paidMode === 'full' ? 'active' : ''} onClick={() => setPaidMode('full')}>Paid Direct</button>
            <button className={paidMode === 'credit' ? 'active' : ''} onClick={() => setPaidMode('credit')}>Credit / Partial</button>
          </div>
        </div>

        {paidMode === 'full' && (
          <div className="cashcalculator">
            <input 
              className="paidinput fullwidth" 
              type="number" 
              step="any" 
              placeholder="Cash received from client..."
              value={cashTendered} 
              onChange={e => setCashTendered(e.target.value)} 
            />
            {Number(cashTendered) > 0 && (
              <div className="changedue">
                Change to return: <strong>{money(changeDue)}</strong>
              </div>
            )}
          </div>
        )}

        {paidMode === 'credit' && (
          <div className="payrow">
            <input className="paidinput fullwidth" type="number" step="any" placeholder="Amount paid now"
              value={amountPaid} onChange={e => setAmountPaid(e.target.value)} />
          </div>
        )}

        <button className="btn primary big" disabled={saving || cart.length === 0} onClick={complete}>
          {saving ? 'Saving…' : `Complete Sale — ${money(total)}`}
        </button>
        {flash && <div className="flash">{flash}</div>}
      </div>

      {/* Printable Receipt Modal */}
      {lastReceipt && (
        <div className="modal-overlay">
          <div className="modal-content receipt-modal">
            <div className="receipt-header">
              <h3>Alimentation Diététique</h3>
              <p>{lastReceipt.businessName} Receipt</p>
              <small>{lastReceipt.date}</small>
            </div>
            <hr />
            <div className="receipt-meta">
              <div>Customer: <strong>{lastReceipt.customerName}</strong></div>
              <div>Seller: {lastReceipt.seller}</div>
            </div>
            <div className="receipt-items">
              {lastReceipt.items.map((it, idx) => (
                <div className="receipt-line" key={idx}>
                  <span>{it.quantity}× {it.product_name}</span>
                  <span>{money(it.line_total)}</span>
                </div>
              ))}
            </div>
            <hr />
            <div className="receipt-totals">
              <div className="kv"><span>Total:</span><strong>{money(lastReceipt.total)}</strong></div>
              <div className="kv"><span>Paid:</span><span>{money(lastReceipt.paid)}</span></div>
              {lastReceipt.debt > 0 && (
                <div className="kv debt-text"><span>Debt Balance:</span><strong>{money(lastReceipt.debt)}</strong></div>
              )}
              {lastReceipt.changeDue > 0 && (
                <div className="kv change-text"><span>Change Returned:</span><strong>{money(lastReceipt.changeDue)}</strong></div>
              )}
            </div>
            <div className="modal-actions">
              <button className="btn primary" onClick={() => window.print()}>🖨️ Print Receipt</button>
              <button className="btn ghost" onClick={() => setLastReceipt(null)}>Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

