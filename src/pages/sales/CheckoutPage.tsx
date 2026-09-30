import { SearchInput } from '../../components/ui/SearchInput';
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
import { StateBlock } from '../../components/ui/StateBlock';
import { BarcodeScanner } from '../../components/BarcodeScanner';
import { OfflineSalesService, isNetworkError } from '../../services/offlineSales.service';
import { setCartCount } from '../../utils/cart-count';
import { usePermissions } from '../../hooks/usePermissions';
import { useToast } from '../../components/ui/Toast';
import { MerchantPaymentService, describeAttempt, type MerchantAttempt, type MoniepointConnection, type MoniepointTerminal } from '../../services/merchantPayment.service';
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
  const { profile, user } = useAuth();
  const { category, config } = useBusinessContext();
  const { hasPermission } = usePermissions();
  const toast = useToast();
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
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadAttempt, setLoadAttempt] = useState(0);
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
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod | 'moniepoint_pos'>('cash');
  const [posConnection, setPosConnection] = useState<MoniepointConnection | null>(null);
  const [posTerminals, setPosTerminals] = useState<MoniepointTerminal[]>([]);
  const [posTerminalId, setPosTerminalId] = useState('');
  const [posAttempt, setPosAttempt] = useState<MerchantAttempt | null>(null);
  const [posChecking, setPosChecking] = useState(false);
  const [checkoutKey, setCheckoutKey] = useState(() => crypto.randomUUID());
  const [requestKey, setRequestKey] = useState(() => crypto.randomUUID());
  const [amountTendered, setAmountTendered] = useState('');
  const [reference, setReference] = useState('');
  const [pendingVerification, setPendingVerification] = useState(false);
  const [orderType, setOrderType] = useState<OrderType>('dine_in');
  const [tableNumber, setTableNumber] = useState('');
  const posSaleLocked = posAttempt !== null && posAttempt.status !== 'successful';

  // Publish the cart size so the bottom navigation can badge Checkout while the
  // cashier is elsewhere in the app. Only the count travels, never the lines.
  useEffect(() => {
    setCartCount(cart.length);
  }, [cart.length]);

  // A store switch must never carry a previous tenant's draft sale into the
  // newly selected workspace.
  useEffect(() => {
    setCart([]);
    setSelectedCustomer(null);
    setCustomerSearch('');
    setSearch('');
    setCategoryId('');
    setPosAttempt(null);
    setCheckoutKey(crypto.randomUUID());
    setRequestKey(crypto.randomUUID());
  }, [storeId]);

  useEffect(() => {
    if (!storeId) return;
    let active = true;
    Promise.all([
      MerchantPaymentService.connection(storeId),
      MerchantPaymentService.terminals(storeId),
      user?.id ? MerchantPaymentService.activeAttempts(storeId, user.id) : Promise.resolve([]),
    ]).then(([connection, terminals, attempts]) => {
      if (!active) return;
      setPosConnection(connection);
      setPosTerminals(terminals);
      setPosTerminalId(terminals.find((terminal) => terminal.isDefault && terminal.status === 'active')?.id
        ?? terminals.find((terminal) => terminal.status === 'active')?.id ?? '');
      const unresolved = attempts.find((attempt) => attempt.initiatedBy === user?.id
        && ['created', 'sending', 'pending', 'unresolved', 'reconciliation_required'].includes(attempt.status));
      if (unresolved) setPosAttempt(unresolved);
    }).catch(() => { if (active) setPosConnection(null); });
    return () => { active = false; };
  }, [storeId, user?.id]);

  useEffect(() => {
    if (!posAttempt || !['sending', 'pending', 'unresolved'].includes(posAttempt.status)) return;
    const resumeWhenOnline = () => setPosAttempt((current) => current ? { ...current } : current);
    window.addEventListener('online', resumeWhenOnline);
    const timeout = window.setTimeout(async () => {
      if (!navigator.onLine) return;
      setPosChecking(true);
      try {
        const result = await MerchantPaymentService.check(posAttempt.id);
        setPosAttempt(result.attempt);
        if (result.attempt.status === 'successful') {
          toast.success('Moniepoint payment verified');
          navigate(`/sales/${result.attempt.saleId}`);
        }
      } catch {
        // A failed status lookup is not a failed payment. Keep the warning visible.
      } finally { setPosChecking(false); }
    }, 8000);
    return () => { window.clearTimeout(timeout); window.removeEventListener('online', resumeWhenOnline); };
  }, [posAttempt, navigate, toast]);

  useEffect(() => {
    if (posAttempt?.status === 'failed' || posAttempt?.status === 'cancelled') {
      setRequestKey(crypto.randomUUID());
    }
  }, [posAttempt?.id, posAttempt?.status]);

  useEffect(() => {
    if (!storeId) {
      setLoading(false);
      setLoadError('Choose a business workspace to start a sale.');
      return;
    }
    let active = true;
    setLoading(true);
    setLoadError(null);
    Promise.all([
      ProductService.getProducts(storeId, { status: 'active' }),
      CategoryService.getCategories(storeId),
      CustomerService.getCustomers(storeId, { isActive: true }),
      StoreService.getStoreSettings(storeId),
    ])
      .then(([productsData, categoriesData, customersData, settingsData]) => {
        if (!active) return;
        setProducts(productsData);
        setCategories(categoriesData);
        setCustomers(customersData);
        setStoreSettings(settingsData);
      })
      .catch((err) => {
        if (active) setLoadError(err instanceof Error ? err.message : 'Failed to load checkout data');
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [storeId, loadAttempt]);

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
    if (posSaleLocked) return;
    setCart((prev) => {
      const existing = prev.find((line) => line.productId === product.id);
      if (existing) {
        return prev.map((line) =>
          line.productId === product.id
            ? { ...line, quantity: line.trackInventory ? Math.min(line.quantity + 1, line.stockQty) : line.quantity + 1 }
            : line
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
    if (posSaleLocked) return;
    setCart((prev) =>
      prev
        .map((line) => (line.productId === productId
          ? { ...line, quantity: line.trackInventory ? Math.min(line.quantity + delta, line.stockQty) : line.quantity + delta }
          : line))
        .filter((line) => line.quantity > 0)
    );
  };

  const removeLine = (productId: string) => {
    if (posSaleLocked) return;
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
    !['created', 'sending', 'pending', 'unresolved', 'reconciliation_required'].includes(posAttempt?.status ?? '') &&
    (paymentMethod !== 'cash' || amountDue >= total) &&
    (!requireCustomer || !!selectedCustomer) &&
    (paymentMethod !== 'credit' || !!selectedCustomer);

  const selectCustomer = (customer: Customer) => {
    if (posSaleLocked) return;
    setSelectedCustomer(customer);
    setCustomerSearch('');
  };

  const clearCustomer = () => {
    if (posSaleLocked) return;
    setSelectedCustomer(null);
    if (paymentMethod === 'credit') setPaymentMethod('cash');
  };

  const handleCompleteSale = async () => {
    if (!storeId || cart.length === 0) return;

    if (paymentMethod === 'moniepoint_pos') {
      if (!navigator.onLine) { setError('Connect to the internet before sending a POS payment request.'); return; }
      if (!posTerminalId) { setError('Choose an active Moniepoint terminal in this branch.'); return; }
      setSaving(true);
      setError(null);
      try {
        const attempt = await MerchantPaymentService.initiate({
          storeId, terminalId: posTerminalId, checkoutKey, requestKey,
          items: cart.map((line) => ({ productId: line.productId, quantity: line.quantity })),
          customerId: selectedCustomer?.id, discountTotal: discount,
          orderType: isRestaurant ? orderType : 'standard',
          tableNumber: isRestaurant && orderType === 'dine_in' ? tableNumber : undefined,
        });
        setPosAttempt(attempt);
        if (attempt.status === 'failed' || attempt.status === 'cancelled') setRequestKey(crypto.randomUUID());
        if (attempt.status === 'successful') navigate(`/sales/${attempt.saleId}`);
        else if (attempt.status === 'unresolved') toast.warning('Payment status is unknown', { description: 'Do not collect another payment until the transaction is verified.' });
        else toast.info('POS request sent', { description: 'Complete payment on the selected terminal.' });
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : 'Could not send the POS request';
        setError(message);
        toast.error('POS request unavailable', { description: message });
      } finally { setSaving(false); }
      return;
    }

    const request: CreateSaleRequest = {
      items: cart.map((line) => ({ productId: line.productId, quantity: line.quantity })),
      payments: [
        {
          method: paymentMethod as PaymentMethod,
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
      toast.info('Sale saved for sync', { description: 'It will be submitted when your connection returns.' });
      navigate('/sales');
      return;
    }

    try {
      const sale = await SaleService.createSale(storeId, request);
      if (isRestaurant) {
        try {
          await SaleService.setOrderMeta(sale.id, orderType, 'new', orderType === 'dine_in' ? tableNumber : undefined);
        } catch {
          toast.warning('Sale recorded, order details need attention', { description: 'The sale succeeded, but its restaurant order details could not be saved.' });
          navigate(`/sales/${sale.id}`);
          return;
        }
      }
      toast.success('Sale recorded');
      navigate(`/sales/${sale.id}`);
    } catch (err) {
      if (isNetworkError(err)) {
        OfflineSalesService.addPendingSale(storeId, request, cart.length, total);
        toast.info('Sale saved for sync', { description: 'It will be submitted when your connection returns.' });
        navigate('/sales');
        return;
      }
      const message = err instanceof Error ? err.message : 'Failed to complete sale';
      setError(message);
      toast.error('Sale could not be recorded', { description: message });
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <PageLoader />;
  if (loadError) return (
    <StateBlock
      variant="error"
      title="Could not load checkout"
      body={loadError}
      actions={<Button variant="outline" onClick={() => setLoadAttempt((attempt) => attempt + 1)}>Try again</Button>}
    />
  );

  return (
    <div className="checkout-page">
      {posAttempt && <div className="card" role="status" style={{ marginBottom: 16 }}>
        <h2 className="list-item-title">{posAttempt.status === 'successful' ? 'Payment verified' :
          posAttempt.status === 'reconciliation_required' ? 'Payment needs review' :
          posAttempt.status === 'failed' || posAttempt.status === 'cancelled' ? 'POS payment did not complete' :
          'Waiting for Moniepoint payment'}</h2>
        <p className="page-subtitle">₦{Number(posAttempt.expectedAmount).toLocaleString()} · Terminal ••••{posAttempt.terminalLastFour} · {posAttempt.merchantReference}</p>
        <p className="page-subtitle">Status: {posAttempt.status.replaceAll('_', ' ')}{posChecking ? ' · Checking…' : ''}</p>
        <p className="page-subtitle">{describeAttempt(posAttempt)}</p>
        {['sending', 'pending', 'unresolved', 'reconciliation_required'].includes(posAttempt.status) &&
          <p className="page-subtitle">Do not collect another payment until this transaction has been verified. A network error can mean the terminal received the request.</p>}
        <div className="btn-row">
          {posAttempt.status !== 'successful' && <Button variant="outline" loading={posChecking}
            onClick={async () => {
              setPosChecking(true);
              try { const result = await MerchantPaymentService.check(posAttempt.id); setPosAttempt(result.attempt);
                if (result.attempt.status === 'successful') navigate(`/sales/${result.attempt.saleId}`);
              } catch (cause) { toast.error('Status check unavailable', { description: cause instanceof Error ? cause.message : undefined }); }
              finally { setPosChecking(false); }
            }}>Check payment status</Button>}
          <Button variant="ghost" onClick={() => navigate('/payments')}>View transactions</Button>
          {['failed', 'cancelled'].includes(posAttempt.status) && <Button variant="ghost" onClick={() => {
            setPosAttempt(null); setCart([]); setCheckoutKey(crypto.randomUUID()); setRequestKey(crypto.randomUUID());
          }}>Start a new sale</Button>}
        </div>
      </div>}
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

          <div className="control-row search-input-row">
            <div>
              <SearchInput
                aria-label="Search products by name, SKU, or barcode"
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
            <StateBlock
              compact
              title={products.length === 0 ? `No ${config.productLabel.toLowerCase()} yet` : 'No matching products'}
              body={products.length === 0 ? 'Add your first item to start taking sales.' : 'Change the search or category filter and try again.'}
              actions={products.length === 0 && hasPermission('product:create') && <Button variant="outline" onClick={() => navigate('/inventory/products/new')}>Add {config.productLabel.toLowerCase()}</Button>}
            />
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
                        <button type="button" onClick={() => updateQuantity(line.productId, -1)} aria-label={`Decrease ${line.name} quantity`}>−</button>
                        <span aria-live="polite" aria-label={`${line.quantity} ${line.unit}`}>{line.quantity}</span>
                        <button type="button" onClick={() => updateQuantity(line.productId, 1)} disabled={line.trackInventory && line.quantity >= line.stockQty} aria-label={`Increase ${line.name} quantity`}>+</button>
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
                  disabled={posSaleLocked}
                >
                  {PAYMENT_METHODS.map((m) => (
                    <option key={m.value} value={m.value} disabled={m.value === 'credit' && !selectedCustomer}>{m.label}</option>
                  ))}
                  {posConnection && <option value="moniepoint_pos">Moniepoint POS</option>}
                </select>

                {paymentMethod === 'cash' ? (
                  <FormField id="amount-tendered" label="Amount tendered (₦)" type="number" value={amountTendered} onChange={setAmountTendered} placeholder={String(total)} />
                ) : paymentMethod === 'credit' ? (
                  <p className="page-subtitle" style={{ marginTop: 8 }}>₦{total.toLocaleString()} added to {selectedCustomer?.name}'s balance.</p>
                ) : paymentMethod === 'moniepoint_pos' ? (
                  <div className="form-group">
                    <label className="form-label" htmlFor="moniepoint-terminal">Terminal</label>
                    <select id="moniepoint-terminal" className="select-input" value={posTerminalId}
                      disabled={posSaleLocked} onChange={(event) => setPosTerminalId(event.target.value)}>
                      <option value="">Choose a terminal</option>
                      {posTerminals.filter((terminal) => terminal.status === 'active').map((terminal) =>
                        <option key={terminal.id} value={terminal.id}>{terminal.name} · ••••{terminal.serialLastFour}</option>)}
                    </select>
                    {(!posConnection?.erpEnabled || !posConnection.amountUnitConfirmed || !posConnection.approvalCodesConfirmed) &&
                      <p className="form-hint">Moniepoint must be connected with ERP integration, amount units, and approval codes confirmed before POS checkout is available.</p>}
                  </div>
                ) : (
                  <FormField id="payment-reference" label="Reference (optional)" value={reference} onChange={setReference} />
                )}

                {paymentMethod !== 'moniepoint_pos' && VERIFIABLE_METHODS.includes(paymentMethod) && (
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

              <Button onClick={handleCompleteSale} loading={saving}
                disabled={!canSubmit || (paymentMethod === 'moniepoint_pos' && (!posTerminalId || !posConnection?.erpEnabled ||
                  !['configured', 'connected'].includes(posConnection.status) || !posConnection.amountUnitConfirmed || !posConnection.approvalCodesConfirmed))}
                style={{ width: '100%', marginTop: 8 }}>
                {paymentMethod === 'moniepoint_pos' ? `Send ₦${total.toLocaleString()} to POS` : `Complete sale — ₦${total.toLocaleString()}`}
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
