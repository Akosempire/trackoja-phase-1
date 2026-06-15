import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { ProductService } from '../../services/product.service';
import { SaleService } from '../../services/sale.service';
import { CustomerService } from '../../services/customer.service';
import { StoreService } from '../../services/store.service';
import { Button } from '../../components/ui/Button';
import { FormField } from '../../components/ui/FormField';
import { PageLoader } from '../../components/ui/PageLoader';
import { BarcodeScanner } from '../../components/BarcodeScanner';
import type { Customer, PaymentMethod, Product, StoreSettings } from '../../types';

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
  const navigate = useNavigate();
  const storeId = profile?.currentStoreId;

  const [products, setProducts] = useState<Product[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [storeSettings, setStoreSettings] = useState<StoreSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [search, setSearch] = useState('');
  const [cart, setCart] = useState<CartLine[]>([]);
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);

  const [customerSearch, setCustomerSearch] = useState('');
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [discountTotal, setDiscountTotal] = useState('0');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('cash');
  const [amountTendered, setAmountTendered] = useState('');
  const [reference, setReference] = useState('');
  const [pendingVerification, setPendingVerification] = useState(false);

  useEffect(() => {
    if (!storeId) return;
    setLoading(true);
    Promise.all([
      ProductService.getProducts(storeId, { status: 'active' }),
      CustomerService.getCustomers(storeId, { isActive: true }),
      StoreService.getStoreSettings(storeId),
    ])
      .then(([productsData, customersData, settingsData]) => {
        setProducts(productsData);
        setCustomers(customersData);
        setStoreSettings(settingsData);
      })
      .catch((err) => setError(err.message ?? 'Failed to load checkout data'))
      .finally(() => setLoading(false));
  }, [storeId]);

  const filteredProducts = useMemo(() => {
    if (!search.trim()) return [];
    const term = search.trim().toLowerCase();
    return products
      .filter(
        (p) =>
          p.name.toLowerCase().includes(term) ||
          p.sku.toLowerCase().includes(term) ||
          (p.barcode ?? '').toLowerCase().includes(term)
      )
      .slice(0, 8);
  }, [products, search]);

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
    setSearch('');
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

    setSaving(true);
    setError(null);
    try {
      const sale = await SaleService.createSale(storeId, {
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
      });

      navigate(`/sales/${sale.id}`);
    } catch (err: any) {
      setError(err.message ?? 'Failed to complete sale');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <PageLoader />;

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Checkout</h1>
          <p className="page-subtitle">{cart.length} item{cart.length === 1 ? '' : 's'} in cart</p>
        </div>
      </div>

      {error && <div className="alert alert-error">{error}</div>}
      {scanError && <div className="alert alert-error">{scanError}</div>}

      <div className="btn-row search-input">
        <div style={{ flex: 1, minWidth: 0 }}>
          <input
            className="form-input"
            placeholder="Search products by name, SKU, or barcode"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setScanError(null);
            }}
          />
        </div>
        <Button
          type="button"
          variant="ghost"
          className="btn-sm"
          onClick={() => {
            setScanError(null);
            setScanning(true);
          }}
        >
          Scan
        </Button>
      </div>

      {scanning && (
        <BarcodeScanner onDetect={handleScan} onClose={() => setScanning(false)} />
      )}

      {filteredProducts.length > 0 && (
        <div className="card">
          <div className="list">
            {filteredProducts.map((product) => {
              const lowStock = product.trackInventory && product.stockQty <= 0;
              return (
                <button
                  key={product.id}
                  type="button"
                  className="list-item"
                  style={{ width: '100%', cursor: 'pointer', font: 'inherit' }}
                  onClick={() => addToCart(product)}
                >
                  <div>
                    <p className="list-item-title">{product.name}</p>
                    <p className="list-item-subtitle">SKU {product.sku}</p>
                  </div>
                  <div className="list-item-meta">
                    <span className={`badge ${lowStock ? 'badge-warning' : 'badge-default'}`}>
                      {product.trackInventory ? `${product.stockQty} ${product.unit}` : 'No tracking'}
                    </span>
                    <span className="list-item-subtitle">₦{product.sellingPrice.toLocaleString()}</span>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div className="card">
        <p className="list-item-title" style={{ marginBottom: 8 }}>
          Cart
        </p>
        {cart.length === 0 ? (
          <div className="empty-state">Search for a product to add it to the cart.</div>
        ) : (
          cart.map((line) => (
            <div key={line.productId} className="cart-item">
              <div className="cart-item-info">
                <div>{line.name}</div>
                <div className="page-subtitle">
                  ₦{line.unitPrice.toLocaleString()} x {line.quantity} = ₦{(line.unitPrice * line.quantity).toLocaleString()}
                </div>
              </div>
              <div className="qty-stepper">
                <button type="button" onClick={() => updateQuantity(line.productId, -1)} aria-label="Decrease quantity">
                  −
                </button>
                <span>{line.quantity}</span>
                <button type="button" onClick={() => updateQuantity(line.productId, 1)} aria-label="Increase quantity">
                  +
                </button>
              </div>
              <Button variant="ghost" className="btn-sm" onClick={() => removeLine(line.productId)}>
                Remove
              </Button>
            </div>
          ))
        )}
      </div>

      {cart.length > 0 && (
        <>
          <div className="card">
            <FormField id="discount-total" label="Discount (₦)" type="number" value={discountTotal} onChange={setDiscountTotal} />
            <div className="totals">
              <div className="total-row">
                <span>Subtotal</span>
                <span>₦{subtotal.toLocaleString()}</span>
              </div>
              <div className="total-row">
                <span>Discount</span>
                <span>−₦{discount.toLocaleString()}</span>
              </div>
              <div className="total-row">
                <span>Tax</span>
                <span>₦{taxTotal.toLocaleString()}</span>
              </div>
              <div className="total-row grand">
                <span>Total</span>
                <span>₦{total.toLocaleString()}</span>
              </div>
            </div>
          </div>

          <div className="card">
            <p className="list-item-title" style={{ marginBottom: 8 }}>
              Customer {requireCustomer ? '(required)' : '(optional)'}
            </p>
            {selectedCustomer ? (
              <div className="list-item" style={{ padding: 0 }}>
                <div>
                  <p className="list-item-title">{selectedCustomer.name}</p>
                  <p className="list-item-subtitle">
                    {selectedCustomer.phone || selectedCustomer.email || 'No contact info'}
                    {' · '}₦{remainingCredit.toLocaleString()} credit available
                  </p>
                </div>
                <Button variant="ghost" className="btn-sm" onClick={clearCustomer}>
                  Change
                </Button>
              </div>
            ) : (
              <>
                <input
                  className="form-input search-input"
                  placeholder="Search customers by name or phone"
                  value={customerSearch}
                  onChange={(e) => setCustomerSearch(e.target.value)}
                />
                {filteredCustomers.length > 0 && (
                  <div className="list">
                    {filteredCustomers.map((customer) => (
                      <button
                        key={customer.id}
                        type="button"
                        className="list-item"
                        style={{ width: '100%', cursor: 'pointer', font: 'inherit' }}
                        onClick={() => selectCustomer(customer)}
                      >
                        <div>
                          <p className="list-item-title">{customer.name}</p>
                          <p className="list-item-subtitle">{customer.phone || customer.email || 'No contact info'}</p>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </>
            )}
            {loyaltyPreview > 0 && (
              <p className="page-subtitle" style={{ marginTop: 8 }}>
                Customer will earn {loyaltyPreview} loyalty point{loyaltyPreview === 1 ? '' : 's'} from this sale.
              </p>
            )}
          </div>

          <div className="card">
            <p className="list-item-title" style={{ marginBottom: 8 }}>
              Payment
            </p>
            <div className="form-group">
              <label className="form-label" htmlFor="payment-method">
                Method
              </label>
              <select
                id="payment-method"
                className="select-input"
                value={paymentMethod}
                onChange={(e) => {
                  setPaymentMethod(e.target.value as PaymentMethod);
                  setPendingVerification(false);
                }}
              >
                {PAYMENT_METHODS.map((m) => (
                  <option key={m.value} value={m.value} disabled={m.value === 'credit' && !selectedCustomer}>
                    {m.label}
                  </option>
                ))}
              </select>
            </div>

            {paymentMethod === 'cash' ? (
              <FormField
                id="amount-tendered"
                label="Amount tendered (₦)"
                type="number"
                value={amountTendered}
                onChange={setAmountTendered}
                placeholder={String(total)}
              />
            ) : paymentMethod === 'credit' ? (
              <p className="page-subtitle">
                ₦{total.toLocaleString()} will be added to {selectedCustomer?.name}'s outstanding balance.
              </p>
            ) : (
              <FormField id="payment-reference" label="Reference (optional)" value={reference} onChange={setReference} />
            )}

            {VERIFIABLE_METHODS.includes(paymentMethod) && (
              <label className="form-label" style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
                <input
                  type="checkbox"
                  checked={pendingVerification}
                  onChange={(e) => setPendingVerification(e.target.checked)}
                />
                Awaiting confirmation (mark pending verification)
              </label>
            )}

            {paymentMethod === 'cash' && (
              <div className="total-row grand">
                <span>Change due</span>
                <span>₦{changeDue.toLocaleString()}</span>
              </div>
            )}
          </div>

          <Button onClick={handleCompleteSale} loading={saving} disabled={!canSubmit}>
            Complete sale
          </Button>
        </>
      )}
    </div>
  );
}
