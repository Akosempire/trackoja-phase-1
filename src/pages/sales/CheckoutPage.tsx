import { formatMoney } from '../../utils/format';
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
import { PageLoader } from '../../components/ui/PageLoader';
import { StateBlock } from '../../components/ui/StateBlock';
import { BarcodeScanner } from '../../components/BarcodeScanner';
import { OfflineSalesService, isNetworkError } from '../../services/offlineSales.service';
import { setCartCount } from '../../utils/cart-count';
import { usePermissions } from '../../hooks/usePermissions';
import { useToast } from '../../components/ui/Toast';
import { Card, Empty, Page, btn, cn, inputClass } from '../../components/kit';
import { ArrowLeftIcon, ChevronRightIcon, ScanIcon, SearchIcon } from '../../components/icons';
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

// In Nigeria "POS" means the card terminal on the counter, so card payments are
// labelled that way. Moniepoint-integrated terminals get their own option below.
const PAYMENT_METHODS: { value: PaymentMethod; label: string }[] = [
  { value: 'cash', label: 'Cash' },
  { value: 'transfer', label: 'Transfer' },
  { value: 'card', label: 'POS / card' },
  { value: 'credit', label: 'On credit' },
  { value: 'other', label: 'Other' },
];

/** Exact amount plus the next few round notes a customer is likely to hand over. */
function quickCash(total: number): number[] {
  if (total <= 0) return [];
  const steps = [500, 1000, 2000, 5000, 10000];
  const out = new Set<number>([Math.ceil(total)]);
  for (const step of steps) {
    const v = Math.ceil(total / step) * step;
    if (v > total) out.add(v);
    if (out.size >= 4) break;
  }
  return [...out].sort((a, b) => a - b);
}

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
  const [cartOpen, setCartOpen] = useState(false);
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

  // An empty "amount received" means the customer paid the exact total.
  const amountDue = paymentMethod === 'cash' ? (amountTendered.trim() === '' ? total : Number(amountTendered) || 0) : total;
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
    <Page>
      <Card>
        <StateBlock
          variant="error"
          title="Could not load checkout"
          body={loadError}
          actions={<Button variant="outline" onClick={() => setLoadAttempt((attempt) => attempt + 1)}>Try again</Button>}
        />
      </Card>
    </Page>
  );

  const itemCount = cart.reduce((sum, line) => sum + line.quantity, 0);
  const submitDisabled = !canSubmit || (paymentMethod === 'moniepoint_pos' && (!posTerminalId || !posConnection?.erpEnabled ||
    !['configured', 'connected'].includes(posConnection.status) || !posConnection.amountUnitConfirmed || !posConnection.approvalCodesConfirmed));
  const methodOptions: { value: PaymentMethod | 'moniepoint_pos'; label: string; disabled?: boolean }[] = [
    ...PAYMENT_METHODS.map((m) => ({ value: m.value, label: m.label, disabled: m.value === 'credit' && !selectedCustomer })),
    ...(posConnection ? [{ value: 'moniepoint_pos' as const, label: 'Moniepoint POS' }] : []),
  ];
  const sectionLabel = 'm-0 mb-2 text-xs font-semibold uppercase tracking-[.06em] text-ink-3';

  return (
    <div className="mx-auto w-full max-w-[1440px] px-4 pb-40 pt-4 sm:px-6 lg:px-8 lg:pb-8 lg:pt-6">
      {posAttempt && (
        <div className={cn('mb-4 rounded-xl border p-4', posAttempt.status === 'successful' ? 'border-success/30 bg-success-soft' :
          ['failed', 'cancelled'].includes(posAttempt.status) ? 'border-danger/30 bg-danger-soft' : 'border-warn/30 bg-warn-soft')} role="status">
          <h2 className="m-0 text-[15px] font-semibold text-ink">{posAttempt.status === 'successful' ? 'Payment verified' :
            posAttempt.status === 'reconciliation_required' ? 'Payment needs review' :
            posAttempt.status === 'failed' || posAttempt.status === 'cancelled' ? 'POS payment did not complete' :
            'Waiting for Moniepoint payment'}</h2>
          <p className="m-0 mt-1 text-[13px] text-ink-2">{formatMoney(Number(posAttempt.expectedAmount))} · Terminal ••••{posAttempt.terminalLastFour} · {posAttempt.merchantReference}</p>
          <p className="m-0 mt-1 text-[13px] text-ink-2">Status: {posAttempt.status.replaceAll('_', ' ')}{posChecking ? ' · Checking…' : ''}</p>
          <p className="m-0 mt-1 text-[13px] text-ink-2">{describeAttempt(posAttempt)}</p>
          {['sending', 'pending', 'unresolved', 'reconciliation_required'].includes(posAttempt.status) &&
            <p className="m-0 mt-2 text-[13px] font-medium text-warn-ink">Do not collect another payment until this transaction has been verified. A network error can mean the terminal received the request.</p>}
          <div className="mt-3 flex flex-wrap gap-2">
            {posAttempt.status !== 'successful' && <Button variant="outline" className="btn-sm" loading={posChecking}
              onClick={async () => {
                setPosChecking(true);
                try { const result = await MerchantPaymentService.check(posAttempt.id); setPosAttempt(result.attempt);
                  if (result.attempt.status === 'successful') navigate(`/sales/${result.attempt.saleId}`);
                } catch (cause) { toast.error('Status check unavailable', { description: cause instanceof Error ? cause.message : undefined }); }
                finally { setPosChecking(false); }
              }}>Check payment status</Button>}
            <Button variant="ghost" className="btn-sm" onClick={() => navigate('/payments')}>View transactions</Button>
            {['failed', 'cancelled'].includes(posAttempt.status) && <Button variant="ghost" className="btn-sm" onClick={() => {
              setPosAttempt(null); setCart([]); setCheckoutKey(crypto.randomUUID()); setRequestKey(crypto.randomUUID());
            }}>Start a new sale</Button>}
          </div>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_400px]">
        {/* Product discovery */}
        <section className="min-w-0" aria-label="Products">
          <div className="mb-4 flex items-end justify-between gap-3">
            <div>
              <h1 className="m-0 text-2xl font-semibold text-ink">{config.saleLabel}</h1>
              <p className="m-0 mt-0.5 text-sm text-ink-3">{products.length} {config.productLabel.toLowerCase()} · tap to add</p>
            </div>
          </div>

          {error && <div className="mb-3 rounded-lg bg-danger-soft px-4 py-2.5 text-[13px] text-danger" role="alert">{error}</div>}
          {scanError && <div className="mb-3 rounded-lg bg-danger-soft px-4 py-2.5 text-[13px] text-danger" role="alert">{scanError}</div>}

          <div className="sticky top-14 z-10 -mx-4 bg-canvas/95 px-4 pb-3 pt-1 backdrop-blur sm:-mx-6 sm:px-6 lg:static lg:mx-0 lg:bg-transparent lg:px-0 lg:backdrop-blur-none">
            <div className="flex gap-2">
              <div className="relative min-w-0 flex-1">
                <SearchIcon width={17} height={17} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-3" />
                <input
                  type="search"
                  className={cn(inputClass, 'h-11 pl-9 text-[15px]')}
                  aria-label="Search products by name, SKU, or barcode"
                  placeholder="Search name, SKU or barcode"
                  value={search}
                  onChange={(e) => { setSearch(e.target.value); setScanError(null); }}
                />
              </div>
              <button type="button" className={cn(btn('primary'), 'h-11 px-4')} onClick={() => { setScanError(null); setScanning(true); }}>
                <ScanIcon width={18} height={18} /><span className="hidden sm:inline">Scan</span><span className="sr-only sm:hidden">Scan a barcode</span>
              </button>
            </div>

            {categories.length > 0 && (
              <div className="mt-3 flex gap-2 overflow-x-auto pb-1" role="group" aria-label="Filter by category">
                {[{ id: '', name: 'All' }, ...categories].map((c) => (
                  <button key={c.id || 'all'} type="button" aria-pressed={categoryId === c.id}
                    className={cn('h-8 shrink-0 rounded-full border px-3.5 text-[13px] font-medium transition-colors',
                      categoryId === c.id ? 'border-ink bg-ink text-surface' : 'border-line-strong bg-surface text-ink-2 hover:text-ink')}
                    onClick={() => setCategoryId(c.id)}>
                    {c.name}
                  </button>
                ))}
              </div>
            )}
          </div>

          {scanning && <BarcodeScanner onDetect={handleScan} onClose={() => setScanning(false)} />}

          {displayedProducts.length === 0 ? (
            <Empty
              title={products.length === 0 ? `No ${config.productLabel.toLowerCase()} yet` : 'No matching products'}
              body={products.length === 0 ? 'Add your first item to start taking sales.' : 'Change the search or category filter and try again.'}
              action={products.length === 0 && hasPermission('product:create') && <Button variant="outline" onClick={() => navigate('/inventory/products/new')}>Add {config.productLabel.toLowerCase()}</Button>}
            />
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
              {displayedProducts.map((product) => {
                const outOfStock = product.trackInventory && product.stockQty <= 0;
                const low = product.trackInventory && !outOfStock && product.stockQty <= product.reorderLevel;
                const inCart = cart.find((line) => line.productId === product.id)?.quantity ?? 0;
                return (
                  <button
                    key={product.id}
                    type="button"
                    className={cn('group relative flex min-w-0 flex-col rounded-xl border bg-surface p-3 text-left shadow-card transition',
                      inCart ? 'border-brand ring-2 ring-brand/20' : 'border-line hover:border-line-strong',
                      outOfStock && 'cursor-not-allowed opacity-55')}
                    disabled={outOfStock}
                    onClick={() => addToCart(product)}
                    aria-label={`${product.name}, ${outOfStock ? 'out of stock' : formatMoney(product.sellingPrice)}${inCart ? `, ${inCart} in sale` : ''}`}
                  >
                    {product.imageUrl ? (
                      <img src={product.imageUrl} alt="" className="aspect-[4/3] w-full rounded-lg object-cover" />
                    ) : (
                      <span className="flex aspect-[4/3] w-full items-center justify-center rounded-lg bg-tray text-2xl font-semibold text-ink-3" aria-hidden="true">{product.name.charAt(0).toUpperCase()}</span>
                    )}
                    {inCart > 0 && <span className="absolute right-2 top-2 inline-flex h-6 min-w-6 items-center justify-center rounded-full bg-brand px-1.5 text-xs font-semibold text-white" aria-hidden="true">{inCart}</span>}
                    <span className="mt-2.5 line-clamp-2 min-h-10 text-sm font-medium leading-5 text-ink">{product.name}</span>
                    <span className="mt-1 flex items-center justify-between gap-2">
                      <span className="text-[15px] font-semibold tabular-nums text-ink">{outOfStock ? 'Out of stock' : formatMoney(product.sellingPrice)}</span>
                      {product.trackInventory && !outOfStock && <span className={cn('text-xs tabular-nums', low ? 'font-semibold text-warn-ink' : 'text-ink-3')}>{product.stockQty} left</span>}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </section>

        {/* Current sale: a sticky panel on desktop, a full-screen sheet on phones */}
        <section
          id="checkout-receipt"
          aria-label="Current sale"
          className={cn('flex-col bg-surface lg:sticky lg:top-24 lg:flex lg:max-h-[calc(100dvh-7rem)] lg:rounded-xl lg:border lg:border-line lg:shadow-card',
            cartOpen ? 'fixed inset-0 z-40 flex' : 'hidden')}
        >
          <header className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-line px-4 lg:px-5">
            <div className="flex items-center gap-2">
              <button type="button" className="inline-flex size-9 items-center justify-center rounded-lg text-ink-2 hover:bg-hover lg:hidden" aria-label="Back to products" onClick={() => setCartOpen(false)}>
                <ArrowLeftIcon width={18} height={18} />
              </button>
              <h2 className="m-0 text-[15px] font-semibold text-ink">Current sale</h2>
            </div>
            {cart.length > 0 && <span className="text-[13px] text-ink-3">{itemCount} item{itemCount === 1 ? '' : 's'}</span>}
          </header>

          {cart.length === 0 ? (
            <div className="flex flex-1 flex-col items-center justify-center px-6 py-16 text-center">
              <span className="inline-flex size-12 items-center justify-center rounded-full bg-tray text-ink-3"><ScanIcon width={22} height={22} /></span>
              <p className="m-0 mt-3 text-sm font-semibold text-ink">No items yet</p>
              <p className="m-0 mt-1 text-[13px] text-ink-3">Scan a barcode or tap a product to add it.</p>
            </div>
          ) : (
            <>
              <div className="flex-1 overflow-y-auto">
                <ul className="m-0 list-none divide-y divide-line p-0" aria-label="Items in this sale">
                  {cart.map((line) => (
                    <li key={line.productId} className="px-4 py-3 lg:px-5">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="m-0 truncate text-sm font-medium text-ink">{line.name}</p>
                          <p className="m-0 text-xs text-ink-3">{formatMoney(line.unitPrice)} each</p>
                        </div>
                        <span className="shrink-0 text-sm font-semibold tabular-nums text-ink">{formatMoney(line.unitPrice * line.quantity)}</span>
                      </div>
                      <div className="mt-2 flex items-center justify-between">
                        <div className="inline-flex items-center rounded-lg border border-line-strong">
                          <button type="button" className="inline-flex size-9 items-center justify-center text-lg text-ink-2 hover:text-ink" onClick={() => updateQuantity(line.productId, -1)} aria-label={`Decrease ${line.name} quantity`}>−</button>
                          <span className="min-w-8 text-center text-sm font-semibold tabular-nums" aria-live="polite" aria-label={`${line.quantity} ${line.unit}`}>{line.quantity}</span>
                          <button type="button" className="inline-flex size-9 items-center justify-center text-lg text-ink-2 hover:text-ink disabled:opacity-40" onClick={() => updateQuantity(line.productId, 1)} disabled={line.trackInventory && line.quantity >= line.stockQty} aria-label={`Increase ${line.name} quantity`}>+</button>
                        </div>
                        <button type="button" className="text-[13px] font-medium text-ink-3 hover:text-danger" onClick={() => removeLine(line.productId)} aria-label={`Remove ${line.name}`}>Remove</button>
                      </div>
                    </li>
                  ))}
                </ul>

                <div className="space-y-4 border-t border-line px-4 py-4 lg:px-5">
                  {isRestaurant && (
                    <div>
                      <p className={sectionLabel}>Order type</p>
                      <div className="grid grid-cols-3 gap-2">
                        {(['dine_in', 'takeaway', 'delivery'] as OrderType[]).map((type) => {
                          const labels: Record<OrderType, string> = { dine_in: 'Dine-in', takeaway: 'Takeaway', delivery: 'Delivery', standard: '' };
                          return (
                            <button key={type} type="button" aria-pressed={orderType === type}
                              className={cn('h-9 rounded-md border text-[13px] font-medium', orderType === type ? 'border-brand bg-brand-soft text-brand-ink' : 'border-line-strong text-ink-2')}
                              onClick={() => setOrderType(type)}>
                              {labels[type]}
                            </button>
                          );
                        })}
                      </div>
                      {orderType === 'dine_in' && (
                        <input className={cn(inputClass, 'mt-2')} aria-label="Table number (optional)" placeholder="Table number (optional)" value={tableNumber} onChange={(e) => setTableNumber(e.target.value)} />
                      )}
                    </div>
                  )}

                  <div>
                    {selectedCustomer ? (
                      <div className="flex items-center gap-3 rounded-lg bg-subtle p-3">
                        <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-full bg-brand-soft text-xs font-semibold text-brand-ink" aria-hidden="true">{selectedCustomer.name.charAt(0).toUpperCase()}</span>
                        <div className="min-w-0 flex-1">
                          <p className="m-0 truncate text-sm font-medium text-ink">{selectedCustomer.name}</p>
                          <p className="m-0 truncate text-xs text-ink-3">
                            {selectedCustomer.phone || selectedCustomer.email || 'No contact'} · {formatMoney(remainingCredit)} credit{loyaltyPreview > 0 ? ` · +${loyaltyPreview} pts` : ''}
                          </p>
                        </div>
                        <button type="button" className="text-[13px] font-medium text-ink-3 hover:text-ink" aria-label="Remove customer" onClick={clearCustomer}>Change</button>
                      </div>
                    ) : (showCustomerSearch || requireCustomer) ? (
                      <>
                        <p className={sectionLabel}>Customer {requireCustomer ? '(required)' : ''}</p>
                        <input type="search" className={inputClass} aria-label="Search customers" placeholder="Search by name or phone" value={customerSearch} onChange={(e) => setCustomerSearch(e.target.value)} autoFocus={!requireCustomer} />
                        {filteredCustomers.length > 0 && (
                          <ul className="m-0 mt-1 list-none overflow-hidden rounded-lg border border-line p-0">
                            {filteredCustomers.map((c) => (
                              <li key={c.id}>
                                <button type="button" className="block w-full px-3 py-2 text-left hover:bg-subtle" onClick={() => selectCustomer(c)}>
                                  <span className="block text-sm font-medium text-ink">{c.name}</span>
                                  <span className="block text-xs text-ink-3">{c.phone || c.email || 'No contact info'}</span>
                                </button>
                              </li>
                            ))}
                          </ul>
                        )}
                        {!requireCustomer && <button type="button" className="mt-2 text-[13px] font-medium text-ink-3" onClick={() => setShowCustomerSearch(false)}>Cancel</button>}
                      </>
                    ) : (
                      <div className="flex flex-wrap gap-x-4 gap-y-2">
                        <button type="button" className="text-[13px] font-semibold text-brand" onClick={() => setShowCustomerSearch(true)}>+ Add customer</button>
                        {!(showDiscount || discount > 0) && <button type="button" className="text-[13px] font-semibold text-brand" onClick={() => setShowDiscount(true)}>+ Add discount</button>}
                      </div>
                    )}
                    {(selectedCustomer || showCustomerSearch || requireCustomer) && !(showDiscount || discount > 0) && (
                      <button type="button" className="mt-3 text-[13px] font-semibold text-brand" onClick={() => setShowDiscount(true)}>+ Add discount</button>
                    )}
                  </div>

                  {(showDiscount || discount > 0) && (
                    <label className="block">
                      <span className={sectionLabel}>Discount (₦)</span>
                      <input id="discount-total" type="number" inputMode="decimal" min={0} className={inputClass} value={discountTotal} onChange={(e) => setDiscountTotal(e.target.value)} />
                    </label>
                  )}

                  <dl className="m-0 space-y-1.5 text-sm">
                    <div className="flex justify-between text-ink-2"><dt>Subtotal</dt><dd className="m-0 tabular-nums">{formatMoney(subtotal)}</dd></div>
                    {discount > 0 && <div className="flex justify-between text-ink-2"><dt>Discount</dt><dd className="m-0 tabular-nums">−{formatMoney(discount)}</dd></div>}
                    {taxTotal > 0 && <div className="flex justify-between text-ink-2"><dt>Tax</dt><dd className="m-0 tabular-nums">{formatMoney(taxTotal)}</dd></div>}
                    <div className="flex items-baseline justify-between border-t border-line pt-3 text-ink"><dt className="text-[15px] font-semibold">Total</dt><dd className="m-0 text-2xl font-semibold tabular-nums">{formatMoney(total)}</dd></div>
                  </dl>

                  <div className="pt-1">
                    <p className={sectionLabel} id="payment-method-label">Payment</p>
                    <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-labelledby="payment-method-label">
                      {methodOptions.map((m) => (
                        <button key={m.value} type="button" role="radio" aria-checked={paymentMethod === m.value}
                          disabled={posSaleLocked || m.disabled}
                          title={m.value === 'credit' && !selectedCustomer ? 'Add a customer to sell on credit' : undefined}
                          className={cn('h-10 rounded-md border px-1 text-[13px] font-medium transition-colors disabled:opacity-40',
                            paymentMethod === m.value ? 'border-brand bg-brand-soft text-brand-ink' : 'border-line-strong bg-surface text-ink-2 hover:text-ink')}
                          onClick={() => { setPaymentMethod(m.value); setPendingVerification(false); }}>
                          {m.label}
                        </button>
                      ))}
                    </div>

                    <div className="mt-3">
                      {paymentMethod === 'cash' ? (
                        <>
                          <label className="block">
                            <span className="mb-1 block text-[13px] font-medium text-ink-2">Amount received (₦)</span>
                            <input id="amount-tendered" type="number" inputMode="decimal" min={0} className={cn(inputClass, 'h-11 text-[15px]')} value={amountTendered} onChange={(e) => setAmountTendered(e.target.value)} placeholder={String(total)} />
                          </label>
                          <div className="mt-2 flex flex-wrap gap-2">
                            {quickCash(total).map((amount) => (
                              <button key={amount} type="button" className="h-8 rounded-full border border-line-strong px-3 text-[13px] font-medium tabular-nums text-ink-2 hover:text-ink"
                                onClick={() => setAmountTendered(String(amount))}>{amount === Math.ceil(total) ? 'Exact' : formatMoney(amount)}</button>
                            ))}
                          </div>
                          <div className="mt-3 flex items-baseline justify-between rounded-lg bg-subtle px-3 py-2">
                            <span className="text-sm font-medium text-ink-2">Change</span>
                            <span className="text-lg font-semibold tabular-nums text-ink">{formatMoney(changeDue)}</span>
                          </div>
                        </>
                      ) : paymentMethod === 'credit' ? (
                        <p className="m-0 rounded-lg bg-subtle px-3 py-2 text-[13px] text-ink-2">{formatMoney(total)} will be added to {selectedCustomer?.name}'s balance.</p>
                      ) : paymentMethod === 'moniepoint_pos' ? (
                        <label className="block">
                          <span className="mb-1 block text-[13px] font-medium text-ink-2">Terminal</span>
                          <select id="moniepoint-terminal" className={inputClass} value={posTerminalId} disabled={posSaleLocked} onChange={(event) => setPosTerminalId(event.target.value)}>
                            <option value="">Choose a terminal</option>
                            {posTerminals.filter((terminal) => terminal.status === 'active').map((terminal) =>
                              <option key={terminal.id} value={terminal.id}>{terminal.name} · ••••{terminal.serialLastFour}</option>)}
                          </select>
                          {(!posConnection?.erpEnabled || !posConnection.amountUnitConfirmed || !posConnection.approvalCodesConfirmed) &&
                            <span className="mt-1 block text-xs text-ink-3">Moniepoint must be connected with ERP integration, amount units, and approval codes confirmed before POS checkout is available.</span>}
                        </label>
                      ) : (
                        <label className="block">
                          <span className="mb-1 block text-[13px] font-medium text-ink-2">{paymentMethod === 'card' ? 'POS receipt / terminal ref (optional)' : 'Reference (optional)'}</span>
                          <input id="payment-reference" className={inputClass} value={reference} onChange={(e) => setReference(e.target.value)} />
                        </label>
                      )}
                      {paymentMethod !== 'moniepoint_pos' && VERIFIABLE_METHODS.includes(paymentMethod) && (
                        <label className="mt-2 flex items-center gap-2 text-[13px] text-ink-2">
                          <input type="checkbox" className="size-4 accent-[var(--color-accent)]" checked={pendingVerification} onChange={(e) => setPendingVerification(e.target.checked)} />
                          Not confirmed yet (check the alert later)
                        </label>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              <div className="shrink-0 border-t border-line p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] lg:px-5 lg:pb-4">
                <Button onClick={handleCompleteSale} loading={saving} disabled={submitDisabled} className="btn-lg w-full">
                  {paymentMethod === 'moniepoint_pos' ? `Send ${formatMoney(total)} to POS` : `Complete sale · ${formatMoney(total)}`}
                </Button>
              </div>
            </>
          )}
        </section>
      </div>

      {/* Phone: a bar above the tabs that opens the sale */}
      {cart.length > 0 && !cartOpen && (
        <button
          type="button"
          className="fixed inset-x-3 bottom-[calc(76px+env(safe-area-inset-bottom))] z-30 flex h-14 items-center justify-between gap-3 rounded-xl bg-contrast px-4 text-white shadow-pop lg:hidden"
          onClick={() => setCartOpen(true)}
        >
          <span className="text-sm"><span className="font-semibold">{itemCount}</span> item{itemCount === 1 ? '' : 's'}</span>
          <span className="text-[15px] font-semibold tabular-nums">{formatMoney(total)}</span>
          <span className="inline-flex items-center gap-1 text-sm font-semibold">Review <ChevronRightIcon width={16} height={16} /></span>
        </button>
      )}
    </div>
  );
}
