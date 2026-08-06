import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../supabaseClient'
import { BUSINESSES, businessOf } from '../lib/businesses'
import { money, num } from '../lib/format'

export default function Sell({ seller }) {
  const [business, setBusiness] = useState('cantine')      // cantine first: highest frequency
  const [priceType, setPriceType] = useState('detail')
  const [paymentMethod, setPaymentMethod] = useState('cash') // 'cash' | 'momo'
  const [allowUnconstrainedStock, setAllowUnconstrainedStock] = useState(true) // Initial setup mode
  const [products, setProducts] = useState([])
  const [cart, setCart] = useState([])
  const [customers, setCustomers] = useState([])
  const [customerId, setCustomerId] = useState('')
  const [paidMode, setPaidMode] = useState('full')          // 'full' | 'credit'
  const [amountPaid, setAmountPaid] = useState('')
  const [cashTendered, setCashTendered] = useState('')
  const [search, setSearch] = useState('')
  const [saving, setSaving] = useState(false)
  const [balances, setBalances] = useState({ cash: 0, momo: 0 })
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
  async function loadBalances() {
    const [{ data: s }, { data: p }, { data: a }, { data: e }] = await Promise.all([
      supabase.from('sales').select('amount_paid, payment_method'),
      supabase.from('payments').select('amount, payment_method'),
      supabase.from('balance_adjustments').select('amount, payment_method'),
      supabase.from('expenses').select('*'),
    ])

    let cash = 0, momo = 0
    ;(s || []).forEach(x => { const amt = Number(x.amount_paid)||0; if (x.payment_method === 'momo') momo += amt; else cash += amt })
    ;(p || []).forEach(x => { const amt = Number(x.amount)||0; if (x.payment_method === 'momo') momo += amt; else cash += amt })
    ;(a || []).forEach(x => { const amt = Number(x.amount)||0; if (x.payment_method === 'momo') momo += amt; else cash += amt })
    ;(e || []).forEach(x => { const amt = Number(x.amount)||0; if (x.payment_method === 'momo') momo -= amt; else cash -= amt })

    setBalances({ cash, momo })
  }

  useEffect(() => { loadProducts(); setCart([]) }, [business])
  useEffect(() => { loadCustomers(); loadBalances() }, [])
  useEffect(() => { if (!biz.hasSupply) setPriceType('detail') }, [business])

  function priceFor(p, tier) {
    if (tier) return priceType === 'supply' ? (tier.supply ?? tier.detail) : tier.detail
    return priceType === 'supply' ? (p.price_supply ?? p.price_detail) : p.price_detail
  }

  function addLine(p, tier) {
    if (!allowUnconstrainedStock && p.track_stock && p.stock <= 0) {
      alert(`"${p.name}" is out of stock! Cannot sell this item.`)
      return
    }
    const qty = tier ? Number(tier.qty) : 1
    const unit = tier ? priceFor(p, tier) / qty : priceFor(p, null)

    const existingInCart = cart
      .filter(l => l.product_id === p.id)
      .reduce((sum, l) => sum + l.quantity, 0)

    if (!allowUnconstrainedStock && p.track_stock && (existingInCart + qty) > p.stock) {
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

  const [showCustModal, setShowCustModal] = useState(false)
  const [custForm, setCustForm] = useState({ name: '', phone: '' })

  const [showServiceModal, setShowServiceModal] = useState(false)
  const [serviceForm, setServiceForm] = useState({ name: '', price: '', qty: '1' })

  const [fundModal, setFundModal] = useState(null) // 'cash' | 'momo' | null
  const [fundForm, setFundForm] = useState({ amount: '', reason: 'Float deposit' })

  function saveCustomService() {
    if (!serviceForm.name.trim() || !serviceForm.price || Number(serviceForm.price) <= 0) {
      alert('Please enter a valid service name and price.')
      return
    }
    const name = `🛠️ ${serviceForm.name.trim()}`
    const price = Number(serviceForm.price)
    const qty = Number(serviceForm.qty) || 1
    const key = 'custom_' + Date.now()

    setCart(prev => [...prev, {
      key,
      product_id: null,
      product_name: name,
      quantity: qty,
      unit_price: price,
    }])

    setShowServiceModal(false)
    setServiceForm({ name: '', price: '', qty: '1' })
  }

  async function saveQuickCustomer() {
    if (!custForm.name.trim()) return
    setSaving(true)
    const { data, error } = await supabase.from('customers').insert({ 
      name: custForm.name.trim(), 
      phone: custForm.phone.trim() || null 
    }).select().single()
    setSaving(false)
    if (!error && data) { 
      await loadCustomers()
      setCustomerId(data.id)
      setShowCustModal(false)
      setCustForm({ name: '', phone: '' })
    }
  }

  async function saveFundDeposit() {
    if (!fundModal) return
    const amt = Number(fundForm.amount)
    if (!amt || isNaN(amt)) return

    setSaving(true)
    const label = fundModal === 'momo' ? 'Mobile Money (MoMo)' : 'Cash in Hand'
    const { error } = await supabase.from('balance_adjustments').insert({
      payment_method: fundModal,
      amount: amt,
      reason: fundForm.reason || 'Manual deposit',
    })
    setSaving(false)
    if (error) { alert(error.message); return }

    setFundModal(null)
    setFundForm({ amount: '', reason: 'Float deposit' })
    await loadBalances()
    setFlash(`${label} updated ✓`); setTimeout(() => setFlash(''), 1500)
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
      payment_method: paymentMethod,
      seller,
      items,
    }
    const { data: saleId, error } = await supabase.rpc('create_sale', { payload })
    setSaving(false)
    if (error) { alert('Could not save: ' + error.message); return }

    await loadBalances()

    setLastReceipt({
      id: saleId,
      date: new Date().toLocaleString(),
      businessName: biz.label,
      customerName: selectedCust?.name || 'Walk-in',
      paymentMethod: paymentMethod === 'momo' ? '📱 Mobile Money (MoMo)' : '💵 Cash',
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

  async function addSpecificFund(method) {
    const label = method === 'momo' ? 'Mobile Money (MoMo)' : 'Cash in Hand'
    const input = prompt(`Add / Deposit money to ${label}:\n(Enter positive amount to add, or negative e.g. -5000 to withdraw):`, '10000')
    if (input == null) return
    const amt = Number(input)
    if (isNaN(amt) || amt === 0) return

    const reason = prompt(`Reason for ${label} addition (optional)?`, 'Float deposit') || 'Manual deposit'

    const { error } = await supabase.from('balance_adjustments').insert({
      payment_method: method,
      amount: amt,
      reason,
    })

    if (error) { alert(error.message); return }
    setFlash(`${label} updated ✓`); setTimeout(() => setFlash(''), 1500)
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

      {/* Live Money Balance Header */}
      <div className="cards" style={{ gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '10px' }}>
        <div className="stat green" style={{ padding: '8px 12px' }}>
          <div className="stat-label" style={{ fontSize: '0.8rem' }}>💵 Cash in Hand</div>
          <div className="stat-value" style={{ fontSize: '1.1rem' }}>{money(balances.cash)}</div>
        </div>
        <div className="stat blue" style={{ padding: '8px 12px' }}>
          <div className="stat-label" style={{ fontSize: '0.8rem' }}>📱 MoMo Balance</div>
          <div className="stat-value" style={{ fontSize: '1.1rem' }}>{money(balances.momo)}</div>
        </div>
      </div>

      {biz.hasSupply && (
        <div className="pricetoggle">
          <button className={priceType === 'detail' ? 'active' : ''} onClick={() => setPriceType('detail')}>Detail price</button>
          <button className={priceType === 'supply' ? 'active' : ''} onClick={() => setPriceType('supply')}>Supply price</button>
        </div>
      )}

      <div className="searchbox" style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
        <input 
          type="text" 
          placeholder="🔍 Search items..." 
          value={search} 
          onChange={e => setSearch(e.target.value)} 
          className="searchinput"
          style={{ flex: 1 }}
        />
        <button className="btn small primary" style={{ whiteSpace: 'nowrap' }} onClick={() => setShowServiceModal(true)}>
          🛠️ + Custom Service / Fee
        </button>
      </div>

      {/* Cart (Top Prominent Position so sellers see order grow immediately) */}
      <div className="cart-container">
        <div className="cart-header">
          <span>🛒 Current Order {cart.length > 0 ? `(${cart.length} items)` : '(Empty)'}</span>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <button className="btn small ghost" style={{ padding: '2px 8px', fontSize: '0.8rem' }} onClick={() => setShowServiceModal(true)}>
              🛠️ + Service / Fee
            </button>
            <span className="cart-total-badge">{money(total)}</span>
          </div>
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
          const isZeroStock = p.track_stock && p.stock <= 0
          const isLowStock = p.track_stock && p.stock > 0 && p.stock <= 5
          const isBlocked = !allowUnconstrainedStock && isZeroStock

          if (tiers && tiers.length) {
            return (
              <div key={p.id} className={`prodcard ${isBlocked ? 'disabled-card' : ''}`}>
                <div className="prodname">
                  {p.name} 
                  {isZeroStock ? <span className="outofstockbadge">0 Stock</span> : isLowStock ? <span className="lowbadge">Low</span> : null}
                </div>
                <div className="tierrow">
                  {tiers.map((t, i) => (
                    <button key={i} className="tierbtn" disabled={isBlocked} onClick={() => addLine(p, t)}>
                      + {t.label}<br /><small>{money(priceFor(p, t))}</small>
                    </button>
                  ))}
                </div>
              </div>
            )
          }
          return (
            <button key={p.id} className={`prodcard tap ${isBlocked ? 'disabled-card' : ''}`} disabled={isBlocked} onClick={() => addLine(p, null)}>
              <div className="prodname">
                {p.name} 
                {isZeroStock ? <span className="outofstockbadge">0 Stock</span> : isLowStock ? <span className="lowbadge">Low</span> : null}
              </div>
              <div className="prodprice">{money(priceFor(p, null))}</div>
              {p.track_stock && (
                <div className={`prodstock ${isZeroStock ? 'danger' : isLowStock ? 'warn' : ''}`}>
                  {isZeroStock ? (allowUnconstrainedStock ? 'stock: 0 (Selling allowed)' : 'Out of stock') : `stock: ${num(p.stock)}`}
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
          <button className="btn ghost" onClick={() => setShowCustModal(true)}>+ Customer</button>
        </div>

        <div className="payrow">
          <label className="pay-label">Payment Method:</label>
          <div className="segmented">
            <button className={paymentMethod === 'cash' ? 'active' : ''} onClick={() => setPaymentMethod('cash')}>💵 Cash</button>
            <button className={paymentMethod === 'momo' ? 'active' : ''} onClick={() => setPaymentMethod('momo')}>📱 MoMo</button>
          </div>
          <div className="quick-fund-actions">
            <button className="btn small ghost" title="Deposit Float Money into Cash" onClick={() => setFundModal('cash')}>💵 + Cash Fund</button>
            <button className="btn small ghost" title="Deposit Float Money into MoMo" onClick={() => setFundModal('momo')}>📱 + MoMo Fund</button>
          </div>
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
              placeholder={paymentMethod === 'cash' ? "Cash received from client..." : "MoMo amount received..."}
              value={cashTendered} 
              onChange={e => setCashTendered(e.target.value)} 
            />
            {Number(cashTendered) > 0 && paymentMethod === 'cash' && (
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

        <div className="setup-mode-box">
          <label className="checkbox small">
            <input 
              type="checkbox" 
              checked={allowUnconstrainedStock} 
              onChange={e => setAllowUnconstrainedStock(e.target.checked)} 
            />
            <span>Allow selling if stock is zero (Initial Setup Mode)</span>
          </label>
        </div>

        <button className="btn primary big" disabled={saving || cart.length === 0} onClick={complete}>
          {saving ? 'Saving…' : `Complete Sale (${paymentMethod === 'momo' ? 'MoMo' : 'Cash'}) — ${money(total)}`}
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
      {/* Modal: Quick Add Customer */}
      {showCustModal && (
        <div className="modal-overlay">
          <div className="modal-content card" style={{ maxWidth: '400px', margin: '0 auto' }}>
            <h3>👤 Add New Customer</h3>
            <label>Customer Name</label>
            <input 
              type="text" 
              value={custForm.name} 
              onChange={e => setCustForm({ ...custForm, name: e.target.value })} 
              placeholder="e.g. Jean Paul" 
            />

            <label>Phone Number (optional)</label>
            <input 
              type="text" 
              value={custForm.phone} 
              onChange={e => setCustForm({ ...custForm, phone: e.target.value })} 
              placeholder="e.g. +250 788 123 456" 
            />

            <div className="modal-actions" style={{ marginTop: '16px' }}>
              <button className="btn primary" disabled={saving || !custForm.name.trim()} onClick={saveQuickCustomer}>
                {saving ? 'Saving...' : 'Save & Select Customer'}
              </button>
              <button className="btn ghost" onClick={() => setShowCustModal(false)}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Deposit / Adjust Fund Balance */}
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

      {/* Modal: Add Custom Service / Extra Fee */}
      {showServiceModal && (
        <div className="modal-overlay">
          <div className="modal-content card" style={{ maxWidth: '420px', margin: '0 auto' }}>
            <h3>🛠️ Add Custom Extra Service / Fee</h3>
            <p className="small muted">Add extra service (e.g. Delivery, Binding, Transport, Milling) to this sale order.</p>

            <label>Service / Fee Name</label>
            <input 
              type="text" 
              value={serviceForm.name} 
              onChange={e => setServiceForm({ ...serviceForm, name: e.target.value })} 
              placeholder="e.g. Delivery Fee, Binding Service, Custom Work" 
            />

            <label>Price / Amount (RWF)</label>
            <input 
              type="number" 
              step="any" 
              value={serviceForm.price} 
              onChange={e => setServiceForm({ ...serviceForm, price: e.target.value })} 
              placeholder="e.g. 1500" 
            />

            <label>Quantity</label>
            <input 
              type="number" 
              step="any" 
              value={serviceForm.qty} 
              onChange={e => setServiceForm({ ...serviceForm, qty: e.target.value })} 
              placeholder="1" 
            />

            <div className="modal-actions" style={{ marginTop: '16px' }}>
              <button className="btn primary" disabled={!serviceForm.name.trim() || !serviceForm.price} onClick={saveCustomService}>
                + Add Service to Order
              </button>
              <button className="btn ghost" onClick={() => setShowServiceModal(false)}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}


