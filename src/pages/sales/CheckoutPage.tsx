import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { useBusinessContext } from '../../contexts/BusinessContext';
import { ProductService } from '../../services/product.service';
import { CategoryService } from '../../services/category.service';
import { SaleService } from '../../services/sale.service';
import { CustomerService } from '../../services/customer.service';
import { StoreService } from '../../services/store.service';
import { Button } from '../../components/ui/Button';
import { FormField } from '../../components/ui/FormField';
import { PageLoader } from '../../components/ui/PageLoader';
import { BarcodeScanner } from '../../components/BarcodeScanner';
import { OfflineSalesService, isNetworkError } from '../../services/offlineSales.service';
import type { Customer, CreateSaleRequest, PaymentMethod, Product, ProductCategory, StoreSettings, OrderType } from '../../types';

interface CartLine {
  productId: string;
  name: string;
  sku: string;
  unit: string;
  unitPrice: number;
  taxRate: number;
  quantity: number;
  trackInventory: boolean;
  stockQty: number;
}

const PAYMENT_METHODS: { value: PaymentMethod; label: string }[] = [
  { value: 'cash', label: 'Cash' },
  { value: 'card', label: 'Card' },
  { value: 'transfer', label: 'Transfer' },
  { value: 'other', label: 'Other' },
  { value: 'credit', label: 'Credit (customer account)' },
];

const VERIFIABLE_METHODS: PaymentMethod[] = ['card', 'transfer', 'other'];

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export default function CheckoutPage() {
  const { profile } = useAuth();
  const { category, config } = useBusinessContext();
  const isRestaurant = category === 'restaurant';
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const storeId = profile?.currentStoreId;

  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<ProductCategory[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [storeSettings, setStoreSettings] = useState<StoreSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [search, setSearch] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [cart, setCart] = useState<CartLine[]>([]);
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);

  const [customerSearch, setCustomerSearch] = useState('');
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [showCustomerSearch, setShowCustomerSearch] = useState(false);
  const [discountTotal, setDiscountTotal] = useState('0');
  const [showDiscount, setShowDiscount] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('cash');
  const [amountTendered, setAmountTendered] = useState('');
  const [reference, setReference] = useState('');
  const [pendingVerification, setPendingVerification] = useState(false);
  const [orderType, setOrderType] = useState<OrderType>('dine_in');
  const [tableNumber, setTableNumber] = useState('');

  useEffect(() => {
    if (!storeId) return;
    setLoading(true);
    Promise.all([
      ProductService.getProducts(storeId, { status: 'active' }),
      CategoryService.getCategories(storeId),
      CustomerService.getCustomers(storeId, { isActive: true }),
      StoreService.getStoreSettings(storeId),
    ])
      .then(([productsData, categoriesData, customersData, settingsData]) => {
        setProducts(productsData);
        setCategories(categoriesData);
        setCustomers(customersData);
        setStoreSettings(settingsData);
      })
      .catch((err) => setError(err.message ?? 'Failed to load checkout data'))
      .finally(() => setLoading(false));
  }, [storeId]);

  useEffect(() => {
    if (loading || searchParams.get('scan') !== '1') return;
    setScanning(true);
    const next = new URLSearchParams(searchParams);
    next.delete('scan');
    setSearchParams(next, { replace: true });
  }, [loading, searchParams, setSearchParams]);

  const displayedProducts = useMemo(() => {
    const term = search.trim().toLowerCase();
    return products
      .filter((p) => !categoryId || p.categoryId === categoryId)
      .filter(
        (p) =>
          !term ||
          p.name.toLowerCase().includes(term) ||
          p.sku.toLowerCase().includes(term) ||
          (p.barcode ?? '').toLowerCase().includes(term)
      )
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [products, search, categoryId]);

  const filteredCustomers = useMemo(() => {
    if (!customerSearch.trim()) return [];
    const term = customerSearch.trim().toLowerCase();
    return customers
      .filter((c) => c.name.toLowerCase().includes(term) || (c.phone ?? '').toLowerCase().includes(term))
      .slice(0, 8);
  }, [customers, customerSearch]);

  const addToCart = (product: Product) => {
    setCart((prev) => {
      const existing = prev.find((line) => line.productId === product.id);
      if (existing) {
        return prev.map((line) =>
          line.productId === product.id ? { ...line, quantity: line.quantity + 1 } : line
        );
      }
      return [
        ...prev,
        {
          productId: product.id,
          name: product.name,
          sku: product.sku,
          unit: product.unit,
          unitPrice: product.sellingPrice,
          taxRate: product.taxRate,
          quantity: 1,
          trackInventory: product.trackInventory,
          stockQty: product.stockQty,
        },
      ];
    });
  };

  const handleScan = (value: string) => {
    setScanning(false);
    const match = products.find((p) => p.barcode === value || p.sku === value);
    if (match) {
      addToCart(match);
      setScanError(null);
    } else {
      setSearch(value);
      setScanError(`No product found for barcode "${value}".`);
    }
  };

  const updateQuantity = (productId: string, delta: number) => {
    setCart((prev) =>
      prev
        .map((line) => (line.productId === productId ? { ...line, quantity: line.quantity + delta } : line))
        .filter((line) => line.quantity > 0)
    );
  };

  const removeLine = (productId: string) => {
    setCart((prev) => prev.filter((line) => line.productId !== productId));
  };

  const subtotal = useMemo(() => round2(cart.reduce((sum, line) => sum + line.quantity * line.unitPrice, 0)), [cart]);
  const taxTotal = useMemo(
    () => round2(cart.reduce((sum, line) => sum + round2((line.quantity * line.unitPrice * line.taxRate) / 100), 0)),
    [cart]
  );
  const discount = Number(discountTotal) || 0;
  const total = useMemo(() => Math.max(round2(subtotal - discount + taxTotal), 0), [subtotal, discount, taxTotal]);

  const amountDue = paymentMethod === 'cash' ? Number(amountTendered) || 0 : total;
  const changeDue = paymentMethod === 'cash' ? Math.max(round2(amountDue - total), 0) : 0;

  const requireCustomer = storeSettings?.requireCustomerForSale ?? false;
  const remainingCredit = selectedCustomer ? round2(selectedCustomer.creditLimit - selectedCustomer.balance) : 0;
  const loyaltyPreview =
    storeSettings?.loyaltyEnabled && selectedCustomer && storeSettings.loyaltyEarnRate > 0
      ? Math.floor(total * storeSettings.loyaltyEarnRate)
      : 0;

  const canSubmit =
    cart.length > 0 &&
    (paymentMethod !== 'cash' || amountDue >= total) &&
    (!requireCustomer || !!selectedCustomer) &&
    (paymentMethod !== 'credit' || !!selectedCustomer);

  const selectCustomer = (customer: Customer) => {
    setSelectedCustomer(customer);
    setCustomerSearch('');
  };

  const clearCustomer = () => {
    setSelectedCustomer(null);
    if (paymentMethod === 'credit') setPaymentMethod('cash');
  };

  const handleCompleteSale = async () => {
    if (!storeId || cart.length === 0) return;

    const request: CreateSaleRequest = {
      items: cart.map((line) => ({ productId: line.productId, quantity: line.quantity })),
      payments: [
        {
          method: paymentMethod,
          amount: paymentMethod === 'cash' ? Math.max(amountDue, total) : total,
          reference: reference || undefined,
          pending: VERIFIABLE_METHODS.includes(paymentMethod) && pendingVerification,
        },
      ],
      customerId: selectedCustomer?.id,
      discountTotal: discount,
    };

    setSaving(true);
    setError(null);

    if (!navigator.onLine) {
      OfflineSalesService.addPendingSale(storeId, request, cart.length, total);
      navigate('/sales');
      return;
    }

    try {
      const sale = await SaleService.createSale(storeId, request);
      if (isRestaurant) {
        await SaleService.setOrderMeta(sale.id, orderType, 'new', orderType === 'dine_in' ? tableNumber : undefined);
      }
      navigate(`/sales/${sale.id}`);
    } catch (err: any) {
      if (isNetworkError(err)) {
        OfflineSalesService.addPendingSale(storeId, request, cart.length, total);
        navigate('/sales');
        return;
      }
      setError(err.message ?? 'Failed to complete sale');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <PageLoader />;

  return (
    <div className="checkout-page">
      {/* Mobile-only sticky jump bar */}
      {cart.length > 0 && (
        <button
          type="button"
          className="cart-sticky-bar"
          onClick={() => document.getElementById('checkout-receipt')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
        >
          <span className="cart-sticky-bar-count">{cart.length} item{cart.length === 1 ? '' : 's'}</span>
          <span className="cart-sticky-bar-total">₦{total.toLocaleString()}</span>
          <span className="cart-sticky-bar-action">View cart ↓</span>
        </button>
      )}

      <div className="checkout-shell">
        {/* ── LEFT PANEL: Product discovery ── */}
        <div className="checkout-products">
          <div className="checkout-products-header">
            <h1 className="page-title">{config.saleLabel}</h1>
            <p className="page-subtitle">{products.length} products</p>
          </div>

          {error && <div className="alert alert-error">{error}</div>}
          {scanError && <div className="alert alert-error">{scanError}</div>}

          <div className="btn-row search-input" style={{ marginBottom: 12 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <input
                className="form-input"
                placeholder="Search by name, SKU, or barcode"
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setScanError(null);
                }}
              />
            </div>
            <Button
              type="button"
              variant="primary"
              className="btn-sm"
              onClick={() => { setScanError(null); setScanning(true); }}
            >
              Scan
            </Button>
          </div>

          {scanning && <BarcodeScanner onDetect={handleScan} onClose={() => setScanning(false)} />}

          {categories.length > 0 && (
            <div className="chip-row">
              <button type="button" className={`chip${categoryId === '' ? ' active' : ''}`} onClick={() => setCategoryId('')}>
                All
              </button>
              {categories.map((c) => (
                <button key={c.id} type="button" className={`chip${categoryId === c.id ? ' active' : ''}`} onClick={() => setCategoryId(c.id)}>
                  {c.name}
                </button>
              ))}
            </div>
          )}

          {displayedProducts.length === 0 ? (
            <div className="empty-state">No products match your search.</div>
          ) : (
            <div className="product-grid">
              {displayedProducts.map((product) => {
                const outOfStock = product.trackInventory && product.stockQty <= 0;
                return (
                  <button
                    key={product.id}
                    type="button"
                    className="product-card"
                    disabled={outOfStock}
                    onClick={() => addToCart(product)}
                  >
                    {product.imageUrl ? (
                      <img src={product.imageUrl} alt="" className="product-card-image" />
                    ) : (
                      <div className="product-card-placeholder">{product.name.charAt(0).toUpperCase()}</div>
                    )}
                    <span className="product-card-name">{product.name}</span>
                    <span className="product-card-price">
                      {outOfStock ? 'Out of stock' : `₦${product.sellingPrice.toLocaleString()}`}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* ── RIGHT PANEL: Live receipt / order summary ── */}
        <div className="checkout-receipt" id="checkout-receipt">
          <div className="checkout-receipt-header">
            <span className="checkout-receipt-title">Order</span>
            {cart.length > 0 && (
              <span className="checkout-receipt-count">{cart.length} item{cart.length === 1 ? '' : 's'}</span>
            )}
          </div>

          {cart.length === 0 ? (
            <div className="checkout-receipt-empty">Tap a product to add it to the order.</div>
          ) : (
            <>
              {/* Line items */}
              <div className="co-lines">
                {cart.map((line) => (
                  <div key={line.productId} className="co-line">
                    <div className="co-line-top">
                      <span className="co-line-name">{line.name}</span>
                      <span className="co-line-total">₦{(line.unitPrice * line.quantity).toLocaleString()}</span>
                    </div>
                    <div className="co-line-bottom">
                      <div className="qty-stepper">
                        <button type="button" onClick={() => updateQuantity(line.productId, -1)} aria-label="Decrease">−</button>
                        <span>{line.quantity}</span>
                        <button type="button" onClick={() => updateQuantity(line.productId, 1)} aria-label="Increase">+</button>
                      </div>
                      <span className="co-line-unit">₦{line.unitPrice.toLocaleString()} ea.</span>
                      <button type="button" className="co-line-remove" onClick={() => removeLine(line.productId)}>✕</button>
                    </div>
                  </div>
                ))}
              </div>

              <div className="receipt-divider" />

              {/* Restaurant: order type */}
              {isRestaurant && (
                <div className="co-section">
                  <p className="co-section-label">Order type</p>
                  <div className="order-type-row">
                    {(['dine_in', 'takeaway', 'delivery'] as OrderType[]).map((type) => {
                      const labels: Record<OrderType, string> = { dine_in: '🪑 Dine-in', takeaway: '🥡 Takeaway', delivery: '🛵 Delivery', standard: '' };
                      return (
                        <button key={type} type="button" className={`order-type-btn${orderType === type ? ' active' : ''}`} onClick={() => setOrderType(type)}>
                          {labels[type]}
                        </button>
                      );
                    })}
                  </div>
                  {orderType === 'dine_in' && (
                    <input className="form-input" style={{ marginTop: 8 }} placeholder="Table number (optional)" value={tableNumber} onChange={(e) => setTableNumber(e.target.value)} />
                  )}
                </div>
              )}

              {/* Customer */}
              <div className="co-section">
                {selectedCustomer ? (
                  <div className="co-customer">
                    <div>
                      <p className="co-customer-name">{selectedCustomer.name}</p>
                      <p className="co-customer-sub">
                        {selectedCustomer.phone || selectedCustomer.email || 'No contact'} · ₦{remainingCredit.toLocaleString()} credit
                      </p>
                      {loyaltyPreview > 0 && <p className="co-customer-sub">+{loyaltyPreview} loyalty pts</p>}
                    </div>
                    <button type="button" className="co-line-remove" onClick={clearCustomer}>✕</button>
                  </div>
                ) : (showCustomerSearch || requireCustomer) ? (
                  <>
                    <p className="co-section-label">Customer {requireCustomer ? '(required)' : ''}</p>
                    <input
                      className="form-input"
                      placeholder="Search by name or phone"
                      value={customerSearch}
                      onChange={(e) => setCustomerSearch(e.target.value)}
                    />
                    {filteredCustomers.length > 0 && (
                      <div className="list" style={{ marginTop: 4 }}>
                        {filteredCustomers.map((c) => (
                          <button key={c.id} type="button" className="list-item" style={{ width: '100%', cursor: 'pointer', font: 'inherit' }} onClick={() => selectCustomer(c)}>
                            <div>
                              <p className="list-item-title">{c.name}</p>
                              <p className="list-item-subtitle">{c.phone || c.email || 'No contact info'}</p>
                            </div>
                          </button>
                        ))}
                      </div>
                    )}
                    {!requireCustomer && (
                      <button type="button" className="co-add-btn" style={{ marginTop: 6 }} onClick={() => setShowCustomerSearch(false)}>Cancel</button>
                    )}
                  </>
                ) : (
                  <button type="button" className="co-add-btn" onClick={() => setShowCustomerSearch(true)}>+ Add customer</button>
                )}
              </div>

              {/* Discount */}
              <div className="co-section">
                {(showDiscount || discount > 0) ? (
                  <FormField id="discount-total" label="Discount (₦)" type="number" value={discountTotal} onChange={setDiscountTotal} />
                ) : (
                  <button type="button" className="co-add-btn" onClick={() => setShowDiscount(true)}>+ Add discount</button>
                )}
              </div>

              <div className="receipt-divider" />

              {/* Totals */}
              <div className="co-totals">
                <div className="co-total-row"><span>Subtotal</span><span>₦{subtotal.toLocaleString()}</span></div>
                {discount > 0 && <div className="co-total-row"><span>Discount</span><span>−₦{discount.toLocaleString()}</span></div>}
                {taxTotal > 0 && <div className="co-total-row"><span>Tax</span><span>₦{taxTotal.toLocaleString()}</span></div>}
                <div className="co-total-row grand"><span>Total</span><span>₦{total.toLocaleString()}</span></div>
              </div>

              <div className="receipt-divider" />

              {/* Payment */}
              <div className="co-section">
                <p className="co-section-label">Payment</p>
                <select
                  className="select-input"
                  value={paymentMethod}
                  onChange={(e) => { setPaymentMethod(e.target.value as PaymentMethod); setPendingVerification(false); }}
                >
                  {PAYMENT_METHODS.map((m) => (
                    <option key={m.value} value={m.value} disabled={m.value === 'credit' && !selectedCustomer}>{m.label}</option>
                  ))}
                </select>

                {paymentMethod === 'cash' ? (
                  <FormField id="amount-tendered" label="Amount tendered (₦)" type="number" value={amountTendered} onChange={setAmountTendered} placeholder={String(total)} />
                ) : paymentMethod === 'credit' ? (
                  <p className="page-subtitle" style={{ marginTop: 8 }}>₦{total.toLocaleString()} added to {selectedCustomer?.name}'s balance.</p>
                ) : (
                  <FormField id="payment-reference" label="Reference (optional)" value={reference} onChange={setReference} />
                )}

                {VERIFIABLE_METHODS.includes(paymentMethod) && (
                  <label className="form-label" style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
                    <input type="checkbox" checked={pendingVerification} onChange={(e) => setPendingVerification(e.target.checked)} />
                    Awaiting confirmation
                  </label>
                )}

                {paymentMethod === 'cash' && (
                  <div className="co-total-row" style={{ marginTop: 10, fontWeight: 600 }}>
                    <span>Change due</span>
                    <span>₦{changeDue.toLocaleString()}</span>
                  </div>
                )}
              </div>

              <Button onClick={handleCompleteSale} loading={saving} disabled={!canSubmit} style={{ width: '100%', marginTop: 8 }}>
                Complete sale — ₦{total.toLocaleString()}
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
