/**
 * The register (/sales/checkout): a focused, full-screen till.
 *
 *  - Built for speed at the counter: the product search is focused and ready
 *    for a USB scanner (keyboard wedge) at all times; a scanner burst is caught
 *    even when focus is somewhere else; F-keys run the whole sale without the
 *    mouse (see utils/register.ts SHORTCUTS).
 *  - Phone: products full width, a sticky cart bar, checkout as a full-screen
 *    sheet; every tap target is at least 44px.
 *  - A sale completes in place (success panel, print / WhatsApp / share); the
 *    next scan, key or tap starts the next sale.
 *  - Split payments, "Confirm later" for transfers and POS, credit with a
 *    customer, Moniepoint terminals, held sales, cashier PIN switching and
 *    manager PIN overrides for what a cashier can't do alone.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { formatMoney } from '../../utils/format';
import { useAuth } from '../../contexts/AuthContext';
import { useBusinessContext } from '../../contexts/BusinessContext';
import { ProductService } from '../../services/product.service';
import { CategoryService } from '../../services/category.service';
import { SaleService } from '../../services/sale.service';
import { CustomerService } from '../../services/customer.service';
import { StoreService } from '../../services/store.service';
import { Button } from '../../components/ui/Button';
import { Dialog } from '../../components/ui/Dialog';
import { PageLoader } from '../../components/ui/PageLoader';
import { StateBlock } from '../../components/ui/StateBlock';
import { BarcodeScanner } from '../../components/BarcodeScanner';
import { OfflineSalesService, isNetworkError } from '../../services/offlineSales.service';
import { setCartCount } from '../../utils/cart-count';
import { usePermissions } from '../../hooks/usePermissions';
import { useToast } from '../../components/ui/Toast';
import { Card, Empty, btn, cn, inputClass } from '../../components/kit';
import { ArrowLeftIcon, ChevronRightIcon, ScanIcon, SearchIcon } from '../../components/icons';
import { MerchantPaymentService, describeAttempt, type MerchantAttempt, type MoniepointConnection, type MoniepointTerminal } from '../../services/merchantPayment.service';
import { CashierSwitch } from '../../components/till/CashierSwitch';
import { TillService, type TillNumbers } from '../../services/till.service';
import { defaultHeldLabel, holdSale, readHeld, type HeldSale } from '../../utils/held-sales';
import { VariantService } from '../../services/variant.service';
import { VariantPicker } from '../../components/VariantPicker';
import { variantLabel } from '../../utils/variants';
import { receiptMessage, whatsappLink } from '../../utils/whatsapp';
import type { ActingCashier } from '../../services/cashier.service';
import type { OverrideAction, OverrideApproval } from '../../services/override.service';
import { ManagerPinDialog } from '../../components/register/ManagerPinDialog';
import { HeldListDialog, HoldDialog, useHeld } from '../../components/register/HeldDialogs';
import { ShortcutsDialog } from '../../components/register/ShortcutsDialog';
import { TillOpenCard } from '../../components/register/TillOpenCard';
import { ReceiptPrint, printReceipt } from '../../components/register/ReceiptPrint';
import {
  ScanBurst, amountOf, beep, buzz, coverage, findByCode, matches, quickCashChips, readPref, round2, salePayments,
  shortcutFor, sortForRegister, writePref, type PaymentLine, type RegisterMethod,
} from '../../utils/register';
import type { Customer, CreateSaleRequest, Product, ProductCategory, ProductVariant, Sale, Store, StoreSettings, OrderType } from '../../types';

interface CartLine {
  /** productId, or productId:variantId for a size/colour */
  key: string;
  productId: string;
  variantId?: string;
  name: string;
  sku: string;
  unit: string;
  unitPrice: number;
  taxRate: number;
  quantity: number;
  trackInventory: boolean;
  stockQty: number;
}

type Method = RegisterMethod | 'moniepoint_pos';

// In Nigeria "POS" means the card terminal on the counter, so card payments are labelled that way.
const METHODS: { value: RegisterMethod; label: string; key: string }[] = [
  { value: 'cash', label: 'Cash', key: 'F4' },
  { value: 'transfer', label: 'Transfer', key: 'F5' },
  { value: 'card', label: 'POS / card', key: 'F6' },
  { value: 'credit', label: 'Credit', key: '' },
  { value: 'other', label: 'Other', key: 'F7' },
];
const FAVOURITES = '__favourites';
const VIEW_KEY = 'trackoja.register.view';

const newLine = (method: RegisterMethod, amount = ''): PaymentLine => ({ id: crypto.randomUUID(), method, amount });
const isTextField = (el: EventTarget | null): el is HTMLInputElement | HTMLTextAreaElement =>
  el instanceof HTMLTextAreaElement || (el instanceof HTMLInputElement && !['checkbox', 'radio', 'button', 'submit'].includes(el.type));
const isInteractive = (el: Element | null) => Boolean(el?.closest('button, a, input, select, textarea, label, [role="button"], [role="radio"], dialog, summary'));

function useWide(): boolean {
  const query = '(min-width: 900px)';
  const [wide, setWide] = useState(() => (typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(query).matches : true));
  useEffect(() => {
    if (!window.matchMedia) return;
    const mq = window.matchMedia(query);
    const on = () => setWide(mq.matches);
    mq.addEventListener?.('change', on);
    return () => mq.removeEventListener?.('change', on);
  }, []);
  return wide;
}

/** Replace a controlled input's value (React sees it as typing). */
function setFieldValue(el: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value')?.set?.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

export default function CheckoutPage() {
  const { profile, user } = useAuth();
  const { category, config } = useBusinessContext();
  const { hasPermission, roleName } = usePermissions();
  const toast = useToast();
  const navigate = useNavigate();
  const wide = useWide();
  const isRestaurant = category === 'restaurant';
  const [searchParams, setSearchParams] = useSearchParams();
  const storeId = profile?.currentStoreId;

  // ---- data ----
  const [store, setStore] = useState<Store | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<ProductCategory[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [settings, setSettings] = useState<StoreSettings | null>(null);
  const [variants, setVariants] = useState<ProductVariant[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadAttempt, setLoadAttempt] = useState(0);

  // ---- browsing ----
  const searchRef = useRef<HTMLInputElement>(null);
  const cashRef = useRef<HTMLInputElement>(null);
  const [search, setSearch] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [view, setView] = useState<'list' | 'grid'>(() => readPref(VIEW_KEY, ['list', 'grid'] as const, typeof window !== 'undefined' && window.innerWidth >= 900 ? 'grid' : 'list'));
  const [highlight, setHighlight] = useState(-1);
  const [notice, setNotice] = useState<{ kind: 'unknown'; code: string } | { kind: 'oos'; product: Product } | { kind: 'pick'; count: number } | null>(null);

  // ---- the sale ----
  const [cart, setCart] = useState<CartLine[]>([]);
  const [lastKey, setLastKey] = useState<string | null>(null);
  const [pickFor, setPickFor] = useState<Product | null>(null);
  const [customerSearch, setCustomerSearch] = useState('');
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [showCustomerSearch, setShowCustomerSearch] = useState(false);
  const [discountTotal, setDiscountTotal] = useState('');
  const [showDiscount, setShowDiscount] = useState(false);
  const [discountApproval, setDiscountApproval] = useState<{ amount: number; by: string; id: string } | null>(null);
  const [orderType, setOrderType] = useState<OrderType>('dine_in');
  const [tableNumber, setTableNumber] = useState('');
  const [method, setMethod] = useState<Method>('cash');
  const [split, setSplit] = useState(false);
  const [lines, setLines] = useState<PaymentLine[]>([newLine('cash')]);
  const [cashEdited, setCashEdited] = useState(false);
  const [reference, setReference] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ sale: Sale | null; total: number; change: number; offline?: boolean; pending?: boolean } | null>(null);
  const [linesExpanded, setLinesExpanded] = useState(false);
  const [pulse, setPulse] = useState(0);

  // ---- Moniepoint terminals ----
  const [posConnection, setPosConnection] = useState<MoniepointConnection | null>(null);
  const [posTerminals, setPosTerminals] = useState<MoniepointTerminal[]>([]);
  const [posTerminalId, setPosTerminalId] = useState('');
  const [posAttempt, setPosAttempt] = useState<MerchantAttempt | null>(null);
  const [posChecking, setPosChecking] = useState(false);
  const [checkoutKey, setCheckoutKey] = useState(() => crypto.randomUUID());
  const [requestKey, setRequestKey] = useState(() => crypto.randomUUID());
  const posSaleLocked = posAttempt !== null && posAttempt.status !== 'successful';

  // ---- till, cashier, dialogs ----
  const [till, setTill] = useState<{ required: boolean; open: TillNumbers | null; loaded: boolean }>({ required: false, open: null, loaded: false });
  const [acting, setActing] = useState<ActingCashier | null>(null);
  const [scanning, setScanning] = useState(false);
  const [holdOpen, setHoldOpen] = useState(false);
  const [heldOpen, setHeldOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [tillOpen, setTillOpen] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [clearOpen, setClearOpen] = useState(false);
  const [override, setOverride] = useState<{ action: OverrideAction; reason?: string; context?: Record<string, unknown>; then: (a: OverrideApproval) => void } | null>(null);
  const held = useHeld(storeId);

  const isManagerRole = ['owner', 'manager'].includes((roleName ?? '').toLowerCase());
  // a cashier is selling: someone switched in by PIN, or the account itself isn't a manager
  const cashierSession = Boolean(acting) || !isManagerRole;
  const canPin = hasPermission('product:update');
  const canAdjust = hasPermission('inventory:adjust');
  const tillBlocked = till.loaded && till.required && !till.open;

  // ---- focus: the search is always ready for the scanner ----
  const keyboardSeen = useRef(false);
  const finePointer = typeof window !== 'undefined' && window.matchMedia?.('(pointer: fine)').matches;
  const focusSearch = useCallback(() => {
    if (!(finePointer || keyboardSeen.current)) return; // don't pop the phone keyboard after every tap
    window.setTimeout(() => {
      if (document.querySelector('dialog[open]')) return;
      searchRef.current?.focus({ preventScroll: true });
    }, 0);
  }, [finePointer]);

  // ---- load ----
  useEffect(() => {
    if (!storeId) { setLoading(false); setLoadError('Choose a business workspace to start a sale.'); return; }
    let active = true;
    setLoading(true); setLoadError(null);
    Promise.all([
      ProductService.getProducts(storeId, { status: 'active' }),
      CategoryService.getCategories(storeId),
      CustomerService.getCustomers(storeId, { isActive: true }),
      StoreService.getStoreSettings(storeId),
      StoreService.getStore(storeId).catch(() => null),
    ])
      .then(([p, c, cu, s, st]) => { if (!active) return; setProducts(p); setCategories(c); setCustomers(cu); setSettings(s); setStore(st); })
      .catch((err) => { if (active) setLoadError(err instanceof Error ? err.message : 'Failed to load the register'); })
      .finally(() => { if (active) setLoading(false); });
    VariantService.forStore(storeId).then((v) => { if (active) setVariants(v); }).catch(() => undefined);
    return () => { active = false; };
  }, [storeId, loadAttempt]);

  useEffect(() => {
    if (!storeId) return;
    let active = true;
    Promise.all([TillService.isRequired(storeId).catch(() => false), TillService.current(storeId).catch(() => null)])
      .then(([required, open]) => { if (active) setTill({ required, open, loaded: true }); });
    return () => { active = false; };
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
      setPosTerminalId(terminals.find((t) => t.isDefault && t.status === 'active')?.id ?? terminals.find((t) => t.status === 'active')?.id ?? '');
      const unresolved = attempts.find((a) => a.initiatedBy === user?.id && ['created', 'sending', 'pending', 'unresolved', 'reconciliation_required'].includes(a.status));
      if (unresolved) setPosAttempt(unresolved);
    }).catch(() => { if (active) setPosConnection(null); });
    return () => { active = false; };
  }, [storeId, user?.id]);

  // a store switch never carries a draft sale into another workspace
  useEffect(() => {
    setCart([]); setSelectedCustomer(null); setCustomerSearch(''); setSearch(''); setCategoryId('');
    setPosAttempt(null); setCheckoutKey(crypto.randomUUID()); setRequestKey(crypto.randomUUID()); setDone(null);
  }, [storeId]);

  useEffect(() => { setCartCount(cart.length); }, [cart.length]);
  useEffect(() => { setError(null); }, [cart, lines, method, selectedCustomer]);
  useEffect(() => { if (!loading) focusSearch(); }, [loading, focusSearch]);

  useEffect(() => {
    if (loading || searchParams.get('scan') !== '1') return;
    setScanning(true);
    const next = new URLSearchParams(searchParams);
    next.delete('scan');
    setSearchParams(next, { replace: true });
  }, [loading, searchParams, setSearchParams]);

  // ---- totals ----
  const subtotal = useMemo(() => round2(cart.reduce((s, l) => s + l.quantity * l.unitPrice, 0)), [cart]);
  const taxTotal = useMemo(() => round2(cart.reduce((s, l) => s + round2((l.quantity * l.unitPrice * l.taxRate) / 100), 0)), [cart]);
  const discount = Math.max(Number(discountTotal) || 0, 0);
  const total = Math.max(round2(subtotal - discount + taxTotal), 0);
  const itemCount = cart.reduce((n, l) => n + l.quantity, 0);
  const discountLimit = settings?.discountLimitPercent ?? null;
  const discountPct = subtotal > 0 ? (discount / subtotal) * 100 : 0;
  const discountNeedsApproval = cashierSession && discountLimit != null && discountPct > discountLimit + 1e-9 && !(discountApproval && discountApproval.amount >= discount);

  // single cash: the amount handed over starts at the exact total and follows it until typed over
  useEffect(() => {
    if (split || method !== 'cash' || cashEdited) return;
    setLines([{ ...newLine('cash', total > 0 ? String(total) : ''), id: 'single' }]);
  }, [total, method, split, cashEdited]);

  const effectiveLines: PaymentLine[] = split ? lines
    : method === 'cash' ? lines
    : method === 'moniepoint_pos' ? []
    : [{ id: 'single', method, amount: String(total), reference }];
  const cov = coverage(total, effectiveLines);
  const hasCredit = effectiveLines.some((l) => l.method === 'credit' && amountOf(l) > 0);
  const paymentStarted = split && lines.some((l) => amountOf(l) > 0);
  const requireCustomer = settings?.requireCustomerForSale ?? false;

  const blockers: string[] = [];
  if (cart.length === 0) blockers.push('Add an item');
  if (tillBlocked) blockers.push('Open the till first');
  if (requireCustomer && !selectedCustomer) blockers.push('Add a customer');
  if (hasCredit && !selectedCustomer) blockers.push('Add a customer to sell on credit');
  if (discountNeedsApproval) blockers.push('The discount needs a manager PIN');
  if (method !== 'moniepoint_pos' && !cov.covered && cart.length > 0) blockers.push(cov.overpaidNonCash ? 'Only cash can be more than the total' : `${formatMoney(cov.remaining)} still to pay`);
  if (['created', 'sending', 'pending', 'unresolved', 'reconciliation_required'].includes(posAttempt?.status ?? '')) blockers.push('Wait for the POS payment');
  const canComplete = blockers.length === 0 && !saving;

  // ---- products shown ----
  const variantsOf = useCallback((productId: string) => variants.filter((v) => v.productId === productId), [variants]);
  const allowNegative = settings?.allowNegativeStock ?? false;
  const favourites = products.filter((p) => p.isFavourite);
  const shown = useMemo(() => {
    const list = products
      .filter((p) => (categoryId === FAVOURITES ? p.isFavourite : !categoryId || p.categoryId === categoryId))
      .filter((p) => matches(p, search));
    return sortForRegister(list, allowNegative);
  }, [products, categoryId, search, allowNegative]);
  useEffect(() => { setHighlight(-1); }, [search, categoryId]);

  // ---- overrides ----
  const needOverride = (action: OverrideAction, reason: string, then: (a: OverrideApproval | null) => void, context: Record<string, unknown> = {}) => {
    if (!cashierSession || !storeId) { then(null); return; }
    setOverride({ action, reason, context, then: (a) => { setOverride(null); then(a); focusSearch(); } });
  };

  // ---- cart actions ----
  const startNewSaleIfDone = () => { if (done) { setDone(null); setSheetOpen(false); } };

  const addToCart = (product: Product, variant?: ProductVariant, fromScan = false) => {
    if (posSaleLocked) return;
    startNewSaleIfDone();
    if (tillBlocked) { setNotice(null); setError('Open the till to start selling.'); return; }
    if (!variant && variantsOf(product.id).length > 0) { setPickFor(product); return; }
    const stock = variant ? variant.stockQty : product.stockQty;
    if (!allowNegative && product.trackInventory && stock <= 0) { setNotice({ kind: 'oos', product }); if (fromScan) beep(false); return; }
    const key = variant ? `${product.id}:${variant.id}` : product.id;
    setCart((prev) => {
      const existing = prev.find((l) => l.key === key);
      if (existing) {
        return prev.map((l) => (l.key === key ? { ...l, quantity: l.trackInventory && !allowNegative ? Math.min(l.quantity + 1, l.stockQty) : l.quantity + 1 } : l));
      }
      return [...prev, {
        key, productId: product.id, variantId: variant?.id,
        name: variant ? `${product.name} – ${variantLabel(variant.size, variant.colour)}` : product.name,
        sku: variant?.sku ?? product.sku, unit: product.unit,
        unitPrice: variant?.sellingPrice ?? product.sellingPrice, taxRate: product.taxRate,
        quantity: 1, trackInventory: product.trackInventory, stockQty: stock,
      }];
    });
    setLastKey(key);
    setNotice(null); setError(null);
    setSearch('');
    setPulse((n) => n + 1);
    buzz(30);
    if (fromScan) beep(true);
    focusSearch();
  };

  /** A scanned or typed code: variant barcode/SKU first, then products. */
  const addByCode = (raw: string): boolean => {
    const code = raw.trim();
    if (!code) return false;
    const variant = variants.find((v) => (v.barcode ?? '').toLowerCase() === code.toLowerCase() || (v.sku ?? '').toLowerCase() === code.toLowerCase());
    const owner = variant && products.find((p) => p.id === variant.productId);
    if (variant && owner) { addToCart(owner, variant, true); return true; }
    const match = findByCode(products, code);
    if (match) { addToCart(match, undefined, true); return true; }
    startNewSaleIfDone();
    setSearch('');
    setNotice({ kind: 'unknown', code });
    beep(false);
    focusSearch();
    return false;
  };

  const changeQty = (key: string, quantity: number, viaKeyboard = false) => {
    if (posSaleLocked) return;
    const line = cart.find((l) => l.key === key);
    if (!line) return;
    const q = Math.max(0, Math.floor(quantity * 1000) / 1000);
    const apply = () => setCart((prev) => prev
      .map((l) => (l.key === key ? { ...l, quantity: l.trackInventory && !allowNegative ? Math.min(q, l.stockQty) : q } : l))
      .filter((l) => l.quantity > 0));
    if (q < line.quantity && paymentStarted) {
      needOverride('remove_after_payment', `Payment has started. A manager approves taking ${line.name} off the sale.`, () => apply(), { item: line.name });
      return;
    }
    apply();
    if (q === 0 && lastKey === key) setLastKey(null);
    if (viaKeyboard) focusSearch();
  };

  const removeLine = (key: string) => {
    if (posSaleLocked) return;
    const index = cart.findIndex((l) => l.key === key);
    const line = cart[index];
    if (!line) return;
    const doRemove = () => {
      setCart((prev) => prev.filter((l) => l.key !== key));
      if (lastKey === key) setLastKey(null);
      toast.info(`Removed ${line.name}`, {
        dedupeKey: 'register-remove',
        action: { label: 'Undo', onClick: () => setCart((prev) => (prev.some((l) => l.key === key) ? prev : [...prev.slice(0, index), line, ...prev.slice(index)])) },
      });
      focusSearch();
    };
    if (paymentStarted) needOverride('remove_after_payment', `Payment has started. A manager approves taking ${line.name} off the sale.`, () => doRemove(), { item: line.name });
    else doRemove();
  };

  const clearSale = () => {
    setCart([]); setSelectedCustomer(null); setCustomerSearch(''); setShowCustomerSearch(false);
    setDiscountTotal(''); setShowDiscount(false); setDiscountApproval(null);
    setMethod('cash'); setSplit(false); setLines([newLine('cash')]); setCashEdited(false); setReference('');
    setError(null); setNotice(null); setLastKey(null); setLinesExpanded(false); setTableNumber('');
    setCheckoutKey(crypto.randomUUID()); setRequestKey(crypto.randomUUID());
  };
  const newSale = () => { clearSale(); setDone(null); setSheetOpen(false); focusSearch(); };

  // ---- held sales ----
  const holdCurrent = (label: string) => {
    if (!storeId || cart.length === 0) return;
    holdSale(storeId, { label, lines: cart, customerId: selectedCustomer?.id ?? null, customerName: selectedCustomer?.name ?? null, discount: discountTotal || '0', total });
    clearSale(); setHoldOpen(false); setSheetOpen(false);
    toast.success('Sale on hold', { description: 'Find it under Held when the customer is ready.' });
    focusSearch();
  };
  const resumeHeld = (h: HeldSale) => {
    if (cart.length > 0 && storeId) {
      holdSale(storeId, { label: defaultHeldLabel(readHeld(storeId).length, selectedCustomer?.name), lines: cart, customerId: selectedCustomer?.id ?? null, customerName: selectedCustomer?.name ?? null, discount: discountTotal || '0', total });
    }
    setDone(null);
    setCart(h.lines.map((l) => ({ ...l, key: l.key ?? (l.variantId ? `${l.productId}:${l.variantId}` : l.productId) })));
    setSelectedCustomer(customers.find((c) => c.id === h.customerId) ?? null);
    setDiscountTotal(Number(h.discount) > 0 ? h.discount : '');
    setShowDiscount(Number(h.discount) > 0);
    setHeldOpen(false);
    if (!wide) setSheetOpen(true);
    focusSearch();
  };

  // ---- payment method ----
  const chooseMethod = (m: Method) => {
    if (posSaleLocked) return;
    if (m === 'credit' && !selectedCustomer) { setShowCustomerSearch(true); setError('Add a customer to sell on credit.'); return; }
    setMethod(m); setSplit(false); setReference(''); setError(null);
    if (m === 'cash') {
      setCashEdited(false);
      setLines([{ ...newLine('cash', total > 0 ? String(total) : ''), id: 'single' }]);
      window.setTimeout(() => { cashRef.current?.focus(); cashRef.current?.select(); }, 0);
    }
  };
  const startSplit = () => {
    const first: PaymentLine = method === 'cash' ? { ...lines[0], id: crypto.randomUUID() } : { ...newLine(method === 'moniepoint_pos' ? 'cash' : method, String(total)), reference };
    const firstAmount = method === 'cash' ? Math.min(amountOf(first), total) : total;
    const firstLine = { ...first, amount: firstAmount > 0 ? String(firstAmount) : '' };
    const rest = round2(total - amountOf(firstLine));
    setLines([firstLine, newLine(firstLine.method === 'cash' ? 'transfer' : 'cash', rest > 0 ? String(rest) : '')]);
    setSplit(true);
  };
  const updateLine = (id: string, patch: Partial<PaymentLine>) => setLines((prev) => prev.map((l) => (l.id === id ? { ...l, ...patch } : l)));

  // ---- complete ----
  const complete = async (confirmLater = false) => {
    if (!storeId || cart.length === 0 || saving) return;
    if (method === 'moniepoint_pos') { await sendToPos(); return; }
    if (!canComplete) { beep(false); return; } // the reason is shown above the Complete button

    const payLines = split ? lines
      : method === 'cash' ? [{ ...lines[0], amount: String(Math.max(amountOf(lines[0]), total)) }]
      : [{ id: 'single', method: method as RegisterMethod, amount: String(total), reference, pending: confirmLater }];
    const payments = salePayments(payLines).map((p) => ({ method: p.method, amount: p.amount, reference: p.reference, pending: p.pending }));
    const notes = discountApproval && discount > 0 ? `Discount approved by ${discountApproval.by} (approval ${discountApproval.id})` : undefined;
    const request: CreateSaleRequest = {
      items: cart.map((l) => ({ productId: l.productId, quantity: l.quantity, ...(l.variantId ? { variantId: l.variantId } : {}) })),
      payments,
      customerId: selectedCustomer?.id,
      discountTotal: discount,
      ...(notes ? { notes } : {}),
    };
    const change = cov.change;
    const anyPending = payments.some((p) => p.pending);
    setSaving(true); setError(null);

    const queueOffline = () => {
      OfflineSalesService.addPendingSale(storeId, request, cart.length, total);
      clearSale();
      setDone({ sale: null, total, change, offline: true });
      if (!wide) setSheetOpen(true);
    };
    if (!navigator.onLine) { queueOffline(); setSaving(false); return; }

    try {
      const sale = await SaleService.createSale(storeId, request);
      if (isRestaurant) {
        await SaleService.setOrderMeta(sale.id, orderType, 'new', orderType === 'dine_in' ? tableNumber : undefined)
          .catch(() => toast.warning('Sale recorded, order details need attention', { description: 'Its restaurant order details could not be saved.' }));
      }
      clearSale();
      setDone({ sale, total: sale.total, change: sale.changeDue ?? change, pending: anyPending });
      if (!wide) setSheetOpen(true);
      if (settings?.autoPrintReceipt && !anyPending) window.setTimeout(printReceipt, 300);
      setTill((t) => (t.open ? { ...t } : t));
    } catch (err) {
      if (isNetworkError(err)) { queueOffline(); return; }
      const message = err instanceof Error ? err.message : 'Failed to complete sale';
      setError(message);
      toast.error('Sale could not be recorded', { description: message });
    } finally {
      setSaving(false);
    }
  };

  const sendToPos = async () => {
    if (!storeId) return;
    if (!navigator.onLine) { setError('Connect to the internet before sending a POS payment request.'); return; }
    if (!posTerminalId) { setError('Choose an active Moniepoint terminal in this branch.'); return; }
    if (cart.some((l) => l.variantId)) { setError("Moniepoint terminal payments don't support sizes and colours yet. Choose POS / card instead."); return; }
    if (blockers.filter((b) => !b.includes('still to pay')).length) { setError(blockers[0]); return; }
    setSaving(true); setError(null);
    try {
      const attempt = await MerchantPaymentService.initiate({
        storeId, terminalId: posTerminalId, checkoutKey, requestKey,
        items: cart.map((l) => ({ productId: l.productId, quantity: l.quantity })),
        customerId: selectedCustomer?.id, discountTotal: discount,
        orderType: isRestaurant ? orderType : 'standard',
        tableNumber: isRestaurant && orderType === 'dine_in' ? tableNumber : undefined,
      });
      setPosAttempt(attempt);
      if (attempt.status === 'failed' || attempt.status === 'cancelled') setRequestKey(crypto.randomUUID());
      if (attempt.status === 'successful' && attempt.saleId) await finishPos(attempt.saleId);
      else if (attempt.status === 'unresolved') toast.warning('Payment status is unknown', { description: 'Do not collect another payment until the transaction is verified.' });
      else toast.info('POS request sent', { description: 'Complete payment on the selected terminal.' });
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'Could not send the POS request';
      setError(message);
      toast.error('POS request unavailable', { description: message });
    } finally { setSaving(false); }
  };
  const finishPos = async (saleId: string) => {
    const sale = await SaleService.getSale(saleId).catch(() => null);
    clearSale(); setPosAttempt(null);
    setDone({ sale, total: sale?.total ?? total, change: 0 });
    if (!wide) setSheetOpen(true);
  };

  useEffect(() => {
    if (!posAttempt || !['sending', 'pending', 'unresolved'].includes(posAttempt.status)) return;
    const resume = () => setPosAttempt((c) => (c ? { ...c } : c));
    window.addEventListener('online', resume);
    const timeout = window.setTimeout(async () => {
      if (!navigator.onLine) return;
      setPosChecking(true);
      try {
        const result = await MerchantPaymentService.check(posAttempt.id);
        setPosAttempt(result.attempt);
        if (result.attempt.status === 'successful' && result.attempt.saleId) { toast.success('Moniepoint payment verified'); await finishPos(result.attempt.saleId); }
      } catch { /* a failed lookup is not a failed payment */ } finally { setPosChecking(false); }
    }, 8000);
    return () => { window.clearTimeout(timeout); window.removeEventListener('online', resume); };
  }, [posAttempt]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- exit ----
  const exitRegister = () => {
    setMenuOpen(false);
    if (cart.length > 0 && !window.confirm('Leave the register? The current sale stays here until you come back.')) return;
    needOverride('exit_register', 'A manager or owner approves leaving the register.', () => navigate('/dashboard'));
  };

  // ---- keyboard: shortcuts and scanner bursts from anywhere ----
  const burst = useRef(new ScanBurst());
  const burstField = useRef<{ el: HTMLInputElement | HTMLTextAreaElement; value: string } | null>(null);
  const lastEsc = useRef(0);
  const pendingDigit = useRef<number | null>(null);
  const handlersRef = useRef<(e: KeyboardEvent) => void>(() => undefined);
  handlersRef.current = (e: KeyboardEvent) => {
    keyboardSeen.current = true;
    if (document.querySelector('dialog[open]') || scanning) return; // dialogs handle their own keys
    const target = e.target as HTMLElement | null;
    const inSearch = target === searchRef.current;
    const inField = isTextField(target) && !inSearch;
    const now = performance.now();
    const plain = e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey;

    // scanner burst typed outside the product search
    if (plain && !inSearch) {
      if (burst.current.length === 0 || now - (burst.current as unknown as { last: number }).last > 50) {
        burstField.current = inField ? { el: target as HTMLInputElement, value: (target as HTMLInputElement).value } : null;
      }
      const building = burst.current.push(e.key, now);
      if (building && pendingDigit.current !== null) { window.clearTimeout(pendingDigit.current); pendingDigit.current = null; }
    }
    if (e.key === 'Enter' && !inSearch) {
      const code = burst.current.enter(now);
      if (code) {
        e.preventDefault(); e.stopPropagation();
        if (burstField.current) setFieldValue(burstField.current.el, burstField.current.value);
        burstField.current = null;
        addByCode(code);
        return;
      }
    }
    if (done && e.key === 'Enter' && !inField && !inSearch) { e.preventDefault(); newSale(); return; }

    // quick-cash chips 1–4 when no field is focused (wait a moment in case it's a scanner)
    if (/^[1-4]$/.test(e.key) && !inField && !inSearch && method === 'cash' && !split && cart.length > 0) {
      const chip = quickCashChips(total)[Number(e.key) - 1];
      if (chip) {
        pendingDigit.current = window.setTimeout(() => { pendingDigit.current = null; setCashEdited(true); setLines([{ ...lines[0], amount: String(chip.amount) }]); }, 90);
      }
      return;
    }

    const action = shortcutFor(e, { inSearch, searchEmpty: search === '', inField });
    if (!action) return;
    e.preventDefault();
    switch (action) {
      case 'focus-search': searchRef.current?.focus(); searchRef.current?.select(); break;
      case 'camera': setScanning(true); break;
      case 'pay-cash': chooseMethod('cash'); if (!wide && cart.length) setSheetOpen(true); break;
      case 'pay-transfer': chooseMethod('transfer'); break;
      case 'pay-card': chooseMethod('card'); break;
      case 'pay-other': chooseMethod('other'); break;
      case 'hold': if (cart.length && !posSaleLocked) setHoldOpen(true); break;
      case 'held': setHeldOpen(true); break;
      case 'complete': if (done) newSale(); else void complete(false); break;
      case 'help': setHelpOpen(true); break;
      case 'qty-up': { const l = cart.find((x) => x.key === lastKey) ?? cart[cart.length - 1]; if (l) changeQty(l.key, l.quantity + 1, true); break; }
      case 'qty-down': { const l = cart.find((x) => x.key === lastKey) ?? cart[cart.length - 1]; if (l) changeQty(l.key, l.quantity - 1, true); break; }
      case 'remove-last': { const l = cart.find((x) => x.key === lastKey) ?? cart[cart.length - 1]; if (l) removeLine(l.key); break; }
      case 'escape': {
        if (sheetOpen && !wide) { setSheetOpen(false); focusSearch(); break; }
        if (search) { setSearch(''); setNotice(null); break; }
        if (notice) { setNotice(null); break; }
        if (now - lastEsc.current < 600 && cart.length) setClearOpen(true);
        lastEsc.current = now;
        focusSearch();
        break;
      }
    }
  };
  useEffect(() => {
    const on = (e: KeyboardEvent) => handlersRef.current(e);
    window.addEventListener('keydown', on, true);
    return () => window.removeEventListener('keydown', on, true);
  }, []);

  // the product search's own keys: exact code, single match, arrow highlight
  const onSearchKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (!search || shown.length === 0) return;
      e.preventDefault();
      setHighlight((h) => (e.key === 'ArrowDown' ? Math.min(h + 1, Math.min(shown.length, 50) - 1) : Math.max(h - 1, 0)));
      return;
    }
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const term = search.trim();
    if (!term) { if (done) newSale(); return; }
    if (highlight >= 0 && shown[highlight]) { addToCart(shown[highlight]); return; }
    const variant = variants.find((v) => (v.barcode ?? '').toLowerCase() === term.toLowerCase() || (v.sku ?? '').toLowerCase() === term.toLowerCase());
    if (variant || findByCode(products, term)) { addByCode(term); return; }
    if (shown.length === 1) { addToCart(shown[0]); return; }
    if (shown.length > 1) { setHighlight(0); setNotice({ kind: 'pick', count: shown.length }); return; }
    addByCode(term);
  };

  // tapping empty space gives focus back to the search (not on phones)
  const onBackgroundClick = (e: React.MouseEvent) => {
    if (isInteractive(e.target as Element)) return;
    if (window.getSelection()?.toString()) return;
    focusSearch();
  };

  // swipe left on a cart line to remove it (touch)
  const swipe = useRef<{ key: string; x: number; dx: number } | null>(null);
  const [swipeX, setSwipeX] = useState<{ key: string; dx: number } | null>(null);

  if (loading) return <PageLoader />;
  if (loadError) {
    return (
      <div className="mx-auto w-full max-w-[760px] p-4">
        <Card><StateBlock variant="error" title="Could not load the register" body={loadError}
          actions={<Button variant="outline" onClick={() => setLoadAttempt((a) => a + 1)}>Try again</Button>} /></Card>
      </div>
    );
  }

  const storeName = store?.name ?? 'Store';
  const chips = quickCashChips(total);
  const cashLine = lines[0];
  const cashGiven = method === 'cash' && !split ? amountOf(cashLine) : 0;
  const showChange = method === 'cash' && !split && cashGiven >= total && total > 0;
  const methodOptions: { value: Method; label: string; key: string; disabled?: boolean; hint?: string }[] = [
    ...METHODS.map((m) => ({ ...m, disabled: m.value === 'credit' && !selectedCustomer, hint: m.value === 'credit' && !selectedCustomer ? 'Add a customer first' : undefined })),
    ...(posConnection ? [{ value: 'moniepoint_pos' as const, label: 'Moniepoint POS', key: '' }] : []),
  ];
  const tap = 'min-h-11 min-w-11';
  const filtered = customerSearch.trim()
    ? customers.filter((c) => c.name.toLowerCase().includes(customerSearch.trim().toLowerCase()) || (c.phone ?? '').includes(customerSearch.trim())).slice(0, 8)
    : [];
  const collapseLines = !wide && cart.length > 3 && !linesExpanded;
  const doneWhen = done?.sale ? new Date(done.sale.createdAt).toLocaleString('en-NG', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '';

  return (
    <div className="no-print flex min-h-0 flex-1 flex-col" onClick={onBackgroundClick}>
      {/* ---- slim top bar ---- */}
      <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center gap-2 border-b border-line bg-surface px-3 sm:px-4">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <span aria-hidden="true" className="hidden size-9 shrink-0 items-center justify-center rounded-lg bg-brand text-sm font-semibold text-white sm:inline-flex">{storeName.charAt(0).toUpperCase()}</span>
          <div className="min-w-0">
            <p className="m-0 truncate text-[15px] font-semibold leading-5 text-ink" title={storeName}>{storeName}</p>
            <p className="m-0 hidden text-[12px] leading-4 text-ink-3 sm:block">Register</p>
          </div>
          <button type="button" onClick={() => (till.open ? (isManagerRole && !acting ? navigate('/till') : toast.info(`Till open since ${new Date(till.open.openedAt).toLocaleTimeString('en-NG', { hour: '2-digit', minute: '2-digit' })}`)) : setTillOpen(true))}
            className={cn('inline-flex h-11 shrink-0 items-center gap-1.5 rounded-full px-3 text-[13px] font-semibold', till.open ? 'bg-success-soft text-success-ink' : 'bg-warn-soft text-warn-ink')}
            aria-label={till.open ? 'Till open' : 'Till closed. Open the till'}>
            <span aria-hidden="true" className={cn('size-2 rounded-full', till.open ? 'bg-success' : 'bg-warn')} />
            <span className="max-[479px]:hidden">{till.open ? 'Till open' : 'Till closed'}</span><span className="min-[480px]:hidden">{till.open ? 'Open' : 'Closed'}</span>
          </button>
        </div>
        {storeId && <CashierSwitch storeId={storeId} accountName={profile?.firstName || undefined} className="h-11 max-w-[150px] sm:max-w-[220px]" onChange={setActing} />}
        <button type="button" onClick={() => setHeldOpen(true)} className={cn(btn('outline'), 'h-11 max-[899px]:hidden')} aria-label={`Held sales, ${held.length}`}>
          Held{held.length > 0 && <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-brand px-1.5 text-[11px] font-semibold text-white">{held.length}</span>}
          <kbd className="hidden text-[11px] font-normal text-ink-3 xl:inline">F9</kbd>
        </button>
        <button type="button" onClick={() => setHelpOpen(true)} className={cn(btn('ghost'), 'h-11 w-11 px-0 max-[899px]:hidden')} aria-label="Keyboard shortcuts" title="Keyboard shortcuts (?)">?</button>
        <div className="relative">
          <button type="button" onClick={() => setMenuOpen((o) => !o)} className={cn(btn('ghost'), 'h-11 w-11 px-0 text-lg')} aria-label="Register menu" aria-haspopup="menu" aria-expanded={menuOpen}>⋯</button>
          {menuOpen && (
            <div role="menu" className="absolute right-0 top-12 z-40 w-64 overflow-hidden rounded-xl border border-line bg-surface py-1 shadow-pop" onClick={(e) => e.stopPropagation()}>
              <button role="menuitem" type="button" className="flex min-h-11 w-full items-center px-4 text-left text-sm text-ink hover:bg-hover" onClick={() => { setMenuOpen(false); setHelpOpen(true); }}>Keyboard shortcuts</button>
              <button role="menuitem" type="button" className="flex min-h-11 w-full items-center px-4 text-left text-sm text-ink hover:bg-hover" onClick={() => { const v = view === 'list' ? 'grid' : 'list'; setView(v); writePref(VIEW_KEY, v); setMenuOpen(false); }}>Show products as {view === 'list' ? 'tiles' : 'a list'}</button>
              {isManagerRole && !acting && storeId && (
                <button role="menuitemcheckbox" aria-checked={settings?.autoPrintReceipt ?? false} type="button" className="flex min-h-11 w-full items-center justify-between px-4 text-left text-sm text-ink hover:bg-hover"
                  onClick={async () => { const on = !(settings?.autoPrintReceipt ?? false); try { await StoreService.setAutoPrintReceipt(storeId, on); setSettings((s) => (s ? { ...s, autoPrintReceipt: on } : s)); toast.success(on ? 'Receipts print after each sale' : 'Auto-print is off'); } catch (x) { toast.error('Not saved', { description: x instanceof Error ? x.message : undefined }); } }}>
                  Auto-print receipts <span className="text-[13px] text-ink-3">{settings?.autoPrintReceipt ? 'On' : 'Off'}</span>
                </button>
              )}
              {cart.length > 0 && <button role="menuitem" type="button" className="flex min-h-11 w-full items-center px-4 text-left text-sm text-danger hover:bg-hover" onClick={() => { setMenuOpen(false); setClearOpen(true); }}>Clear this sale</button>}
              {(isManagerRole || acting) && <button role="menuitem" type="button" className="flex min-h-11 w-full items-center border-t border-line px-4 text-left text-sm font-semibold text-ink hover:bg-hover" onClick={exitRegister}>Exit register{cashierSession ? ' (manager PIN)' : ''}</button>}
            </div>
          )}
        </div>
      </header>

      {/* ---- body: products left, sale right (≥900px) ---- */}
      <div className="grid min-h-0 flex-1 min-[900px]:grid-cols-[minmax(0,1fr)_380px]">
        <section aria-label="Products" className="min-w-0 px-3 pb-44 pt-3 sm:px-4 min-[900px]:h-[calc(100dvh-3.5rem)] min-[900px]:overflow-y-auto min-[900px]:pb-6">
          {posAttempt && (
            <div className={cn('mb-3 rounded-xl border p-4', posAttempt.status === 'successful' ? 'border-success/30 bg-success-soft' : ['failed', 'cancelled'].includes(posAttempt.status) ? 'border-danger/30 bg-danger-soft' : 'border-warn/30 bg-warn-soft')} role="status">
              <h2 className="m-0 text-[15px] font-semibold text-ink">{posAttempt.status === 'successful' ? 'Payment verified' : posAttempt.status === 'reconciliation_required' ? 'Payment needs review' : ['failed', 'cancelled'].includes(posAttempt.status) ? 'POS payment did not complete' : 'Waiting for Moniepoint payment'}</h2>
              <p className="m-0 mt-1 text-[13px] text-ink-2">{formatMoney(Number(posAttempt.expectedAmount))} · Terminal ••••{posAttempt.terminalLastFour} · {posAttempt.merchantReference}{posChecking ? ' · Checking…' : ''}</p>
              <p className="m-0 mt-1 text-[13px] text-ink-2">{describeAttempt(posAttempt)}</p>
              {['sending', 'pending', 'unresolved', 'reconciliation_required'].includes(posAttempt.status) && <p className="m-0 mt-2 text-[13px] font-medium text-warn-ink">Do not collect another payment until this transaction has been verified.</p>}
              <div className="mt-3 flex flex-wrap gap-2">
                {posAttempt.status !== 'successful' && <Button variant="outline" className="h-11" loading={posChecking} onClick={async () => {
                  setPosChecking(true);
                  try { const r = await MerchantPaymentService.check(posAttempt.id); setPosAttempt(r.attempt); if (r.attempt.status === 'successful' && r.attempt.saleId) await finishPos(r.attempt.saleId); }
                  catch (c) { toast.error('Status check unavailable', { description: c instanceof Error ? c.message : undefined }); }
                  finally { setPosChecking(false); }
                }}>Check payment status</Button>}
                {['failed', 'cancelled'].includes(posAttempt.status) && <Button variant="ghost" className="h-11" onClick={() => { setPosAttempt(null); newSale(); }}>Start a new sale</Button>}
              </div>
            </div>
          )}

          {tillBlocked && storeId && <TillOpenCard storeId={storeId} onOpened={(t) => { setTill((s) => ({ ...s, open: t })); toast.success('Till open. Start selling'); focusSearch(); }} />}

          {/* search + camera: the one Scan entry point */}
          <div className="sticky top-14 z-20 -mx-3 bg-canvas/95 px-3 pb-2 pt-1 backdrop-blur sm:-mx-4 sm:px-4 min-[900px]:top-0">
            <div className="flex gap-2">
              <div className="relative min-w-0 flex-1">
                <SearchIcon width={18} height={18} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-3" />
                <input
                  ref={searchRef} type="search" autoComplete="off" enterKeyHint="go"
                  className={cn(inputClass, 'h-12 pl-10 text-[16px]')}
                  aria-label="Scan or search products by name, SKU or barcode"
                  aria-controls="register-products" aria-activedescendant={highlight >= 0 && shown[highlight] ? `p-${shown[highlight].id}` : undefined}
                  placeholder="Scan or search name, SKU, barcode"
                  value={search}
                  onChange={(e) => { if (done) { setDone(null); setSheetOpen(false); } setSearch(e.target.value); setNotice(null); }}
                  onKeyDown={onSearchKey}
                />
              </div>
              <button type="button" className={cn(btn('primary'), 'h-12 px-4')} onClick={() => setScanning(true)} aria-label="Scan with the camera (F3)">
                <ScanIcon width={20} height={20} /><span className="hidden sm:inline">Camera</span>
              </button>
            </div>

            {notice?.kind === 'unknown' && (
              <p className="m-0 mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg bg-danger-soft px-3 py-2 text-[13px] text-danger" role="alert">
                <span>No product with code <strong className="font-mono">{notice.code.length > 24 ? `${notice.code.slice(0, 24)}…` : notice.code}</strong></span>
                {hasPermission('product:create') && <Link to={`/inventory/products/new?barcode=${encodeURIComponent(notice.code)}`} className="tap font-semibold text-danger underline">Add product</Link>}
              </p>
            )}
            {notice?.kind === 'oos' && (
              <p className="m-0 mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg bg-warn-soft px-3 py-2 text-[13px] text-warn-ink" role="alert">
                <span><strong>{notice.product.name}</strong> is out of stock{canAdjust ? ' – adjust stock?' : '. Ask a manager to check the stock.'}</span>
                {canAdjust && <Link to={`/inventory/stock?product=${notice.product.id}`} className="tap font-semibold underline">Adjust stock</Link>}
              </p>
            )}
            {notice?.kind === 'pick' && <p className="m-0 mt-2 text-[13px] text-ink-2" role="status">{notice.count} matches. Use ↑ ↓ and Enter, or tap one.</p>}
            {error && <p className="m-0 mt-2 rounded-lg bg-danger-soft px-3 py-2 text-[13px] text-danger" role="alert">{error}</p>}

            <div className="mt-2 flex items-center gap-2">
              <div className="flex min-w-0 flex-1 gap-2 overflow-x-auto pb-1 [scrollbar-width:none]" role="tablist" aria-label="Categories">
                {[{ id: '', name: 'All' }, ...((favourites.length || canPin) ? [{ id: FAVOURITES, name: '★ Favourites' }] : []), ...categories].map((c) => (
                  <button key={c.id || 'all'} type="button" role="tab" aria-selected={categoryId === c.id}
                    className={cn('h-11 shrink-0 rounded-full border px-4 text-[13px] font-medium transition-colors',
                      categoryId === c.id ? 'border-ink bg-ink text-surface' : 'border-line-strong bg-surface text-ink-2 hover:text-ink')}
                    onClick={() => { setCategoryId(c.id); focusSearch(); }}>{c.name}</button>
                ))}
              </div>
              <div className="hidden shrink-0 rounded-lg border border-line-strong p-0.5 sm:inline-flex" role="group" aria-label="Product view">
                {(['list', 'grid'] as const).map((v) => (
                  <button key={v} type="button" aria-pressed={view === v} onClick={() => { setView(v); writePref(VIEW_KEY, v); focusSearch(); }}
                    className={cn('h-10 rounded-md px-3 text-[13px] font-medium', view === v ? 'bg-ink text-surface' : 'text-ink-2')}>{v === 'list' ? 'List' : 'Tiles'}</button>
                ))}
              </div>
            </div>
          </div>

          {scanning && <BarcodeScanner onDetect={(code) => { setScanning(false); addByCode(code); }} onClose={() => { setScanning(false); focusSearch(); }} />}
          {pickFor && <VariantPicker product={pickFor} variants={variantsOf(pickFor.id)} onPick={(v) => { addToCart(pickFor, v); setPickFor(null); }} onClose={() => { setPickFor(null); focusSearch(); }} />}

          {shown.length === 0 ? (
            <div className="mt-3">
              <Empty
                title={products.length === 0 ? `No ${config.productLabel.toLowerCase()} yet` : categoryId === FAVOURITES ? 'No favourites yet' : 'No matching products'}
                body={products.length === 0 ? 'Add your first item to start taking sales.' : categoryId === FAVOURITES ? (canPin ? 'Tap the ☆ on a product to pin it here.' : 'A manager can pin quick-sell items here.') : 'Change the search or category and try again.'}
                action={products.length === 0 && hasPermission('product:create') ? <Button variant="outline" onClick={() => navigate('/inventory/products/new')}>Add {config.productLabel.toLowerCase()}</Button> : undefined}
              />
            </div>
          ) : view === 'list' ? (
            <ul id="register-products" role="listbox" aria-label="Products" className="m-0 mt-2 list-none divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface p-0">
              {shown.slice(0, 300).map((p, i) => {
                const out = !allowNegative && p.trackInventory && p.stockQty <= 0;
                const low = p.trackInventory && !out && p.stockQty <= p.reorderLevel;
                const inCart = cart.filter((l) => l.productId === p.id).reduce((n, l) => n + l.quantity, 0);
                return (
                  <li key={p.id} id={`p-${p.id}`} role="option" aria-selected={i === highlight}
                    className={cn('flex min-h-16 items-center gap-2 pl-3 pr-2', i === highlight && 'bg-brand-soft', out && 'opacity-60')}>
                    <button type="button" className="flex min-h-16 min-w-0 flex-1 items-center gap-3 py-2 text-left" onClick={() => addToCart(p)}
                      aria-label={`${p.name}, ${formatMoney(p.sellingPrice)}${out ? ', out of stock' : ''}${inCart ? `, ${inCart} in sale` : ''}`}>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[15px] font-medium text-ink">{p.name}</span>
                        <span className={cn('block text-[12.5px]', out ? 'font-semibold text-danger' : low ? 'font-semibold text-warn-ink' : 'text-ink-3')}>
                          {out ? 'Out of stock' : p.trackInventory ? `${p.stockQty} left` : p.sku}
                        </span>
                      </span>
                      <span className="shrink-0 text-[15px] font-semibold tabular-nums text-ink">{formatMoney(p.sellingPrice)}</span>
                    </button>
                    {canPin && (
                      <button type="button" className={cn('inline-flex size-11 shrink-0 items-center justify-center rounded-lg text-lg', p.isFavourite ? 'text-warn' : 'text-ink-3 hover:text-ink')}
                        aria-pressed={Boolean(p.isFavourite)} aria-label={p.isFavourite ? `Unpin ${p.name}` : `Pin ${p.name} to Favourites`}
                        onClick={async () => { const fav = !p.isFavourite; setProducts((all) => all.map((x) => (x.id === p.id ? { ...x, isFavourite: fav } : x))); try { await ProductService.setFavourite(p.id, fav); } catch (x) { setProducts((all) => all.map((y) => (y.id === p.id ? { ...y, isFavourite: !fav } : y))); toast.error('Not pinned', { description: x instanceof Error ? x.message : undefined }); } }}>
                        {p.isFavourite ? '★' : '☆'}
                      </button>
                    )}
                    <button type="button" tabIndex={-1} aria-hidden="true" onClick={() => addToCart(p)}
                      className={cn('relative inline-flex size-11 shrink-0 items-center justify-center rounded-lg text-xl font-semibold', inCart ? 'bg-brand text-white' : 'bg-brand-soft text-brand-ink')}>
                      {inCart ? <span className="text-[15px] tabular-nums">{inCart}</span> : '+'}
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : (
            <div id="register-products" role="listbox" aria-label="Products" className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
              {shown.slice(0, 300).map((p, i) => {
                const out = !allowNegative && p.trackInventory && p.stockQty <= 0;
                const low = p.trackInventory && !out && p.stockQty <= p.reorderLevel;
                const inCart = cart.filter((l) => l.productId === p.id).reduce((n, l) => n + l.quantity, 0);
                return (
                  <button key={p.id} id={`p-${p.id}`} role="option" aria-selected={i === highlight} type="button" onClick={() => addToCart(p)}
                    className={cn('relative flex min-w-0 flex-col rounded-xl border bg-surface p-3 text-left shadow-card transition',
                      inCart ? 'border-brand ring-2 ring-brand/20' : i === highlight ? 'border-brand' : 'border-line hover:border-line-strong', out && 'opacity-55')}
                    aria-label={`${p.name}, ${formatMoney(p.sellingPrice)}${out ? ', out of stock' : ''}${inCart ? `, ${inCart} in sale` : ''}`}>
                    {p.imageUrl
                      ? <img src={p.imageUrl} alt="" className="aspect-[4/3] w-full rounded-lg object-cover" />
                      : <span className="flex aspect-[4/3] w-full items-center justify-center rounded-lg bg-tray text-2xl font-semibold text-ink-3" aria-hidden="true">{p.name.charAt(0).toUpperCase()}</span>}
                    {inCart > 0 && <span key={`${p.id}-${inCart}`} className="register-pop absolute right-2 top-2 inline-flex h-7 min-w-7 items-center justify-center rounded-full bg-brand px-2 text-[13px] font-semibold text-white" aria-hidden="true">{inCart}</span>}
                    {p.isFavourite && <span className="absolute left-2 top-2 text-warn" aria-hidden="true">★</span>}
                    <span className="mt-2.5 line-clamp-2 min-h-10 text-sm font-medium leading-5 text-ink">{p.name}</span>
                    <span className="mt-1 flex items-center justify-between gap-2">
                      <span className="text-[15px] font-semibold tabular-nums text-ink">{formatMoney(p.sellingPrice)}</span>
                      {p.trackInventory && <span className={cn('text-xs tabular-nums', out ? 'font-semibold text-danger' : low ? 'font-semibold text-warn-ink' : 'text-ink-3')}>{out ? 'Out' : `${p.stockQty} left`}</span>}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </section>

        {/* ---- the sale: right column on ≥900px, full-screen sheet on phones ---- */}
        <section
          aria-label="Current sale"
          className={cn('flex-col bg-surface min-[900px]:sticky min-[900px]:top-14 min-[900px]:flex min-[900px]:h-[calc(100dvh-3.5rem)] min-[900px]:border-l min-[900px]:border-line',
            sheetOpen ? 'fixed inset-0 z-40 flex' : 'hidden')}
        >
          <header className="flex h-14 shrink-0 items-center justify-between gap-2 border-b border-line px-3 sm:px-4">
            <div className="flex min-w-0 items-center gap-1">
              <button type="button" className={cn(btn('ghost'), 'h-11 w-11 px-0 min-[900px]:hidden')} aria-label="Back to products" onClick={() => { setSheetOpen(false); }}>
                <ArrowLeftIcon width={20} height={20} />
              </button>
              <h2 className="m-0 truncate text-[15px] font-semibold text-ink">{done ? 'Sale complete' : 'Current sale'}</h2>
              {cart.length > 0 && <span className="ml-1 text-[13px] text-ink-3">{itemCount} item{itemCount === 1 ? '' : 's'}</span>}
            </div>
            {!done && (
              <div className="flex items-center gap-1.5">
                <Button variant="outline" className="h-11" disabled={cart.length === 0 || posSaleLocked} onClick={() => setHoldOpen(true)}>Hold</Button>
                <button type="button" onClick={() => setHeldOpen(true)} className={cn(btn('outline'), 'h-11 min-[900px]:hidden')} aria-label={`Held sales, ${held.length}`}>
                  Held{held.length > 0 && <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-brand px-1.5 text-[11px] font-semibold text-white">{held.length}</span>}
                </button>
              </div>
            )}
          </header>

          {done ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-5 overflow-y-auto px-5 py-8 text-center" role="status" aria-live="polite">
              <span className={cn('inline-flex size-16 items-center justify-center rounded-full text-3xl font-bold text-white', done.offline || done.pending ? 'bg-warn' : 'bg-success')} aria-hidden="true">{done.offline || done.pending ? '…' : '✓'}</span>
              <div>
                <p className="m-0 text-xl font-semibold text-ink">{done.offline ? 'Saved offline' : done.pending ? 'Sale saved. Payment to confirm' : 'Sale complete'}</p>
                <p className="m-0 mt-1 text-sm text-ink-2">
                  {done.offline ? 'It will sync when you are back online.' : `${done.sale ? `Receipt #${done.sale.saleNumber} · ${doneWhen} · ` : ''}Total ${formatMoney(done.total)}`}
                </p>
              </div>
              {done.change > 0 && (
                <div className="w-full rounded-2xl bg-success-soft px-4 py-4">
                  <p className="m-0 text-sm font-medium text-success-ink">Change due</p>
                  <p className="m-0 text-[40px] font-bold leading-[48px] tabular-nums text-success-ink">{formatMoney(done.change)}</p>
                </div>
              )}
              {done.sale && (
                <div className="grid w-full grid-cols-2 gap-2">
                  <Button variant="outline" className="h-12" onClick={printReceipt}>Print</Button>
                  <a className={cn(btn('outline'), 'h-12')} target="_blank" rel="noopener noreferrer"
                    href={whatsappLink(done.sale.customerPhone ?? null, receiptMessage({
                      storeName, receiptNumber: `#${done.sale.saleNumber}`, date: doneWhen,
                      items: (done.sale.items ?? []).map((i) => ({ name: i.productName, quantity: i.quantity, lineTotal: i.lineTotal })),
                      total: done.sale.total, paid: Math.min(done.sale.total, done.sale.amountPaid - done.sale.changeDue), balance: Math.max(0, done.sale.total - (done.sale.amountPaid - done.sale.changeDue)),
                    }))}>WhatsApp</a>
                  <Button variant="outline" className="h-12" onClick={async () => {
                    const s = done.sale!;
                    const text = [`${storeName} · #${s.saleNumber}`, ...(s.items ?? []).map((i) => `${i.quantity} × ${i.productName}  ${formatMoney(i.lineTotal)}`), `Total: ${formatMoney(s.total)}`].join('\n');
                    try { if (navigator.share) await navigator.share({ title: `Receipt #${s.saleNumber}`, text }); else { await navigator.clipboard.writeText(text); toast.success('Receipt copied'); } } catch { /* closed */ }
                  }}>Share</Button>
                  <Link className={cn(btn('outline'), 'h-12')} to={`/sales/${done.sale.id}`}>View receipt</Link>
                </div>
              )}
              <Button className="h-14 w-full text-[16px]" onClick={newSale}>New sale <kbd className="ml-1 rounded border border-white/40 bg-transparent px-1.5 text-[12px] font-normal text-white max-[899px]:hidden">Enter</kbd></Button>
              <p className="m-0 text-[12.5px] text-ink-3">Scanning the next item starts a new sale.</p>
            </div>
          ) : cart.length === 0 ? (
            <div className="flex flex-1 flex-col items-center justify-center px-6 py-16 text-center">
              <span className="inline-flex size-12 items-center justify-center rounded-full bg-tray text-ink-3"><ScanIcon width={22} height={22} /></span>
              <p className="m-0 mt-3 text-sm font-semibold text-ink">Ready for the next customer</p>
              <p className="m-0 mt-1 text-[13px] text-ink-3">Scan a barcode or tap a product.</p>
              <button type="button" onClick={() => setHelpOpen(true)} className="mt-3 hidden min-h-11 text-[13px] font-medium text-brand-ink min-[900px]:inline">Keyboard shortcuts</button>
            </div>
          ) : (
            <>
              <div className="min-h-0 flex-1 overflow-y-auto">
                {collapseLines ? (
                  <button type="button" onClick={() => setLinesExpanded(true)} className="flex min-h-14 w-full items-center justify-between border-b border-line px-4 text-left">
                    <span className="text-sm font-medium text-ink">{itemCount} items · {formatMoney(subtotal)}</span>
                    <span className="text-[13px] font-semibold text-brand-ink">Show items</span>
                  </button>
                ) : (
                  <ul className="m-0 list-none divide-y divide-line p-0" aria-label="Items in this sale">
                    {cart.map((line) => {
                      const dx = swipeX?.key === line.key ? swipeX.dx : 0;
                      return (
                        <li key={line.key} className={cn('relative overflow-hidden', line.key === lastKey && 'bg-brand-soft/40')}>
                          {dx < 0 && <span className="absolute inset-y-0 right-0 flex items-center bg-danger px-4 text-[13px] font-semibold text-white" aria-hidden="true">Remove</span>}
                          <div className="relative bg-inherit px-3 py-2.5 sm:px-4" style={{ transform: dx ? `translateX(${dx}px)` : undefined }}
                            onPointerDown={(e) => { if (e.pointerType === 'touch') swipe.current = { key: line.key, x: e.clientX, dx: 0 }; }}
                            onPointerMove={(e) => { const s = swipe.current; if (!s || s.key !== line.key) return; s.dx = Math.min(0, e.clientX - s.x); if (s.dx < -8) setSwipeX({ key: line.key, dx: s.dx }); }}
                            onPointerUp={() => { const s = swipe.current; swipe.current = null; setSwipeX(null); if (s && s.dx < -90) removeLine(s.key); }}
                            onPointerCancel={() => { swipe.current = null; setSwipeX(null); }}>
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0">
                                <p className="m-0 truncate text-sm font-medium text-ink">{line.name}</p>
                                <p className="m-0 text-xs text-ink-3">{formatMoney(line.unitPrice)} each</p>
                              </div>
                              <span className="shrink-0 text-sm font-semibold tabular-nums text-ink">{formatMoney(round2(line.unitPrice * line.quantity))}</span>
                            </div>
                            <div className="mt-1.5 flex items-center justify-between gap-2">
                              <div className="inline-flex items-center rounded-lg border border-line-strong">
                                <button type="button" className={cn(tap, 'inline-flex items-center justify-center text-xl text-ink-2 hover:text-ink')} onClick={() => changeQty(line.key, line.quantity - 1)} aria-label={`One less ${line.name}`}>−</button>
                                <input type="text" inputMode="decimal" aria-label={`${line.name} quantity`} value={String(line.quantity)}
                                  className="h-11 w-14 border-x border-line-strong bg-transparent text-center text-[15px] font-semibold tabular-nums text-ink focus:outline-none focus:ring-2 focus:ring-brand/30"
                                  onFocus={(e) => e.currentTarget.select()}
                                  onChange={(e) => { const n = Number(e.target.value.replace(',', '.')); if (e.target.value === '' ) return; if (Number.isFinite(n)) changeQty(line.key, n); }}
                                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); focusSearch(); } }} />
                                <button type="button" className={cn(tap, 'inline-flex items-center justify-center text-xl text-ink-2 hover:text-ink disabled:opacity-40')} onClick={() => changeQty(line.key, line.quantity + 1)} disabled={line.trackInventory && !allowNegative && line.quantity >= line.stockQty} aria-label={`One more ${line.name}`}>+</button>
                              </div>
                              <button type="button" className={cn(tap, 'inline-flex items-center justify-center rounded-lg text-ink-3 hover:bg-danger-soft hover:text-danger')} onClick={() => removeLine(line.key)} aria-label={`Remove ${line.name}`} title="Remove (Delete)">
                                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3" /></svg>
                              </button>
                            </div>
                          </div>
                        </li>
                      );
                    })}
                    {!wide && cart.length > 3 && <li><button type="button" className="min-h-11 w-full text-[13px] font-semibold text-brand-ink" onClick={() => setLinesExpanded(false)}>Hide items</button></li>}
                  </ul>
                )}

                <div className="space-y-3 border-t border-line px-3 py-3 sm:px-4">
                  {isRestaurant && (
                    <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Order type">
                      {(['dine_in', 'takeaway', 'delivery'] as OrderType[]).map((t) => (
                        <button key={t} type="button" role="radio" aria-checked={orderType === t} onClick={() => setOrderType(t)}
                          className={cn('h-11 rounded-md border text-[13px] font-medium', orderType === t ? 'border-brand bg-brand-soft text-brand-ink' : 'border-line-strong text-ink-2')}>
                          {{ dine_in: 'Dine-in', takeaway: 'Takeaway', delivery: 'Delivery', standard: '' }[t]}
                        </button>
                      ))}
                      {orderType === 'dine_in' && <input className={cn(inputClass, 'col-span-3 h-11')} aria-label="Table number (optional)" placeholder="Table number (optional)" value={tableNumber} onChange={(e) => setTableNumber(e.target.value)} />}
                    </div>
                  )}

                  {selectedCustomer ? (
                    <div className="flex items-center gap-3 rounded-lg bg-subtle p-2 pl-3">
                      <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-full bg-brand-soft text-xs font-semibold text-brand-ink" aria-hidden="true">{selectedCustomer.name.charAt(0).toUpperCase()}</span>
                      <div className="min-w-0 flex-1">
                        <p className="m-0 truncate text-sm font-medium text-ink">{selectedCustomer.name}</p>
                        <p className="m-0 truncate text-xs text-ink-3">{selectedCustomer.phone || 'No phone'} · {formatMoney(round2(selectedCustomer.creditLimit - selectedCustomer.balance))} credit left</p>
                      </div>
                      <Button variant="ghost" className="h-11" onClick={() => { setSelectedCustomer(null); if (method === 'credit') chooseMethod('cash'); }}>Change</Button>
                    </div>
                  ) : (showCustomerSearch || requireCustomer) ? (
                    <div>
                      <input type="search" className={cn(inputClass, 'h-11')} aria-label="Search customers" placeholder={`Customer name or phone${requireCustomer ? ' (required)' : ''}`} value={customerSearch} onChange={(e) => setCustomerSearch(e.target.value)} autoFocus={showCustomerSearch} />
                      {filtered.length > 0 && (
                        <ul className="m-0 mt-1 list-none overflow-hidden rounded-lg border border-line p-0">
                          {filtered.map((c) => (
                            <li key={c.id}><button type="button" className="block min-h-11 w-full px-3 py-2 text-left hover:bg-subtle" onClick={() => { setSelectedCustomer(c); setCustomerSearch(''); setShowCustomerSearch(false); setError(null); }}>
                              <span className="block text-sm font-medium text-ink">{c.name}</span><span className="block text-xs text-ink-3">{c.phone || c.email || 'No contact'}</span>
                            </button></li>
                          ))}
                        </ul>
                      )}
                      {!requireCustomer && <Button variant="ghost" className="mt-1 h-11" onClick={() => { setShowCustomerSearch(false); focusSearch(); }}>Cancel</Button>}
                    </div>
                  ) : null}

                  {(showDiscount || discount > 0) && (
                    <div>
                      <label className="flex flex-col gap-1 text-[13px] font-medium text-ink-2">Discount (₦)
                        <input type="text" inputMode="decimal" className={cn(inputClass, 'h-11')} value={discountTotal} placeholder="0"
                          onChange={(e) => { setDiscountTotal(e.target.value.replace(/[^\d.]/g, '')); }} />
                      </label>
                      {discountLimit != null && cashierSession && discount > 0 && (
                        discountNeedsApproval ? (
                          <div className="mt-1.5 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-warn-soft px-3 py-1.5 text-[13px] text-warn-ink">
                            <span>Over the {discountLimit}% limit. A manager approves it.</span>
                            <Button variant="outline" className="h-11" onClick={() => needOverride('discount', `A discount of ${formatMoney(discount)} (${Math.round(discountPct)}%) is over the ${discountLimit}% limit.`, (a) => setDiscountApproval({ amount: discount, by: a?.approverName ?? 'Manager', id: a?.approvalId ?? '' }), { amount: discount, percent: Math.round(discountPct * 10) / 10 })}>Manager PIN</Button>
                          </div>
                        ) : discountApproval && <p className="m-0 mt-1 text-[12.5px] text-success-ink">Approved by {discountApproval.by}</p>
                      )}
                    </div>
                  )}

                  {!(selectedCustomer || showCustomerSearch || requireCustomer) || !(showDiscount || discount > 0) ? (
                    <div className="grid grid-cols-2 gap-2">
                      {!(selectedCustomer || showCustomerSearch || requireCustomer) && <Button variant="outline" className="h-11" onClick={() => setShowCustomerSearch(true)}>+ Customer</Button>}
                      {!(showDiscount || discount > 0) && <Button variant="outline" className="h-11" onClick={() => setShowDiscount(true)}>+ Discount</Button>}
                    </div>
                  ) : null}

                  <dl className="m-0 space-y-1 text-sm">
                    <div className="flex justify-between text-ink-2"><dt>Subtotal</dt><dd className="m-0 tabular-nums">{formatMoney(subtotal)}</dd></div>
                    {discount > 0 && <div className="flex justify-between text-ink-2"><dt>Discount</dt><dd className="m-0 tabular-nums">−{formatMoney(discount)}</dd></div>}
                    {taxTotal > 0 && <div className="flex justify-between text-ink-2"><dt>Tax</dt><dd className="m-0 tabular-nums">{formatMoney(taxTotal)}</dd></div>}
                    <div className="flex items-baseline justify-between border-t border-line pt-2 text-ink"><dt className="text-[15px] font-semibold">Total</dt><dd key={pulse} className="register-pulse m-0 text-2xl font-semibold tabular-nums">{formatMoney(total)}</dd></div>
                  </dl>

                  {/* payment */}
                  <div>
                    <p className="m-0 mb-1.5 text-xs font-semibold uppercase tracking-[.06em] text-ink-3" id="pay-label">Payment</p>
                    {!split && (
                      <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-labelledby="pay-label">
                        {methodOptions.map((m) => (
                          <button key={m.value} type="button" role="radio" aria-checked={method === m.value} disabled={posSaleLocked}
                            onClick={() => chooseMethod(m.value)} title={m.hint ?? (m.key ? `${m.label} (${m.key})` : m.label)}
                            className={cn('flex min-h-12 flex-col items-center justify-center rounded-lg border px-1 text-[13px] font-semibold leading-4 transition-colors',
                              method === m.value ? 'border-brand bg-brand-soft text-brand-ink ring-1 ring-brand' : 'border-line-strong bg-surface text-ink-2 hover:text-ink',
                              m.disabled && 'border-dashed text-ink-3')}>
                            {m.label}
                            {m.hint ? <span className="mt-0.5 text-[10.5px] font-normal leading-3">{m.hint}</span> : m.key ? <span className="mt-0.5 hidden text-[10.5px] font-normal text-ink-3 min-[900px]:block">{m.key}</span> : null}
                          </button>
                        ))}
                      </div>
                    )}

                    {!split && method === 'cash' && (
                      <div className="mt-3">
                        <label className="flex flex-col gap-1 text-[13px] font-medium text-ink-2">Cash received (₦)
                          <input ref={cashRef} id="amount-tendered" type="text" inputMode="decimal" className={cn(inputClass, 'h-12 text-[18px] font-semibold tabular-nums')}
                            value={cashLine?.amount ?? ''} placeholder="Enter amount" onFocus={(e) => e.currentTarget.select()}
                            onChange={(e) => { setCashEdited(true); setLines([{ ...(cashLine ?? newLine('cash')), amount: e.target.value.replace(/[^\d.]/g, '') }]); }}
                            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void complete(false); } }} />
                        </label>
                        <div className="mt-2 grid grid-cols-4 gap-2">
                          {chips.map((c, i) => (
                            <button key={c.amount} type="button" onClick={() => { setCashEdited(true); setLines([{ ...(cashLine ?? newLine('cash')), amount: String(c.amount) }]); }}
                              className={cn('min-h-11 rounded-lg border px-1 text-[13px] font-semibold tabular-nums', amountOf(cashLine) === c.amount ? 'border-brand bg-brand-soft text-brand-ink' : 'border-line-strong text-ink-2 hover:text-ink')}
                              title={`Key ${i + 1}`}>{c.label === 'Exact' ? 'Exact' : formatMoney(c.amount)}</button>
                          ))}
                        </div>
                        {showChange ? (
                          <div className="mt-3 rounded-xl bg-success-soft px-3 py-2.5">
                            <p className="m-0 text-[13px] font-medium text-success-ink">Change due</p>
                            <p className="m-0 text-[34px] font-bold leading-10 tabular-nums text-success-ink">{formatMoney(round2(cashGiven - total))}</p>
                          </div>
                        ) : cashGiven > 0 && cashGiven < total ? (
                          <p className="m-0 mt-3 rounded-xl bg-danger-soft px-3 py-2.5 text-[20px] font-bold tabular-nums text-danger" role="status">{formatMoney(round2(total - cashGiven))} short</p>
                        ) : null}
                      </div>
                    )}

                    {!split && (method === 'transfer' || method === 'card' || method === 'other') && (
                      <label className="mt-3 flex flex-col gap-1 text-[13px] font-medium text-ink-2">{method === 'card' ? 'POS slip / terminal ref (optional)' : 'Reference (optional)'}
                        <input className={cn(inputClass, 'h-11')} value={reference} onChange={(e) => setReference(e.target.value)} />
                      </label>
                    )}
                    {!split && method === 'credit' && <p className="m-0 mt-3 rounded-lg bg-subtle px-3 py-2 text-[13px] text-ink-2">{formatMoney(total)} goes on {selectedCustomer?.name}'s account.</p>}
                    {!split && method === 'moniepoint_pos' && (
                      <label className="mt-3 flex flex-col gap-1 text-[13px] font-medium text-ink-2">Terminal
                        <select className={cn(inputClass, 'h-11')} value={posTerminalId} disabled={posSaleLocked} onChange={(e) => setPosTerminalId(e.target.value)}>
                          <option value="">Choose a terminal</option>
                          {posTerminals.filter((t) => t.status === 'active').map((t) => <option key={t.id} value={t.id}>{t.name} · ••••{t.serialLastFour}</option>)}
                        </select>
                      </label>
                    )}

                    {split && (
                      <div className="space-y-2">
                        {lines.map((l, i) => (
                          <div key={l.id} className="rounded-lg border border-line p-2">
                            <div className="flex items-center gap-2">
                              <select aria-label={`Payment ${i + 1} method`} className={cn(inputClass, 'h-11 w-32 shrink-0')} value={l.method}
                                onChange={(e) => updateLine(l.id, { method: e.target.value as RegisterMethod, pending: false })}>
                                {METHODS.map((m) => <option key={m.value} value={m.value} disabled={m.value === 'credit' && !selectedCustomer}>{m.label}</option>)}
                              </select>
                              <input aria-label={`Payment ${i + 1} amount`} type="text" inputMode="decimal" className={cn(inputClass, 'h-11 min-w-0 flex-1 text-[16px] font-semibold tabular-nums')}
                                value={l.amount} placeholder="Amount" onFocus={(e) => e.currentTarget.select()} onChange={(e) => updateLine(l.id, { amount: e.target.value.replace(/[^\d.]/g, '') })} />
                              {lines.length > 1 && <button type="button" className={cn(tap, 'inline-flex items-center justify-center rounded-lg text-ink-3 hover:text-danger')} aria-label={`Remove payment ${i + 1}`} onClick={() => setLines((p) => p.filter((x) => x.id !== l.id))}>✕</button>}
                            </div>
                            {(l.method === 'transfer' || l.method === 'card' || l.method === 'other') && (
                              <div className="mt-2 flex gap-2">
                                <input aria-label={`Payment ${i + 1} reference`} className={cn(inputClass, 'h-11 min-w-0 flex-1')} placeholder="Reference (optional)" value={l.reference ?? ''} onChange={(e) => updateLine(l.id, { reference: e.target.value })} />
                                <div className="inline-flex shrink-0 rounded-lg border border-line-strong p-0.5" role="radiogroup" aria-label={`Payment ${i + 1} status`}>
                                  <button type="button" role="radio" aria-checked={!l.pending} onClick={() => updateLine(l.id, { pending: false })} className={cn('h-10 rounded-md px-2.5 text-[12.5px] font-semibold', !l.pending ? 'bg-success-soft text-success-ink' : 'text-ink-3')}>Received</button>
                                  <button type="button" role="radio" aria-checked={Boolean(l.pending)} onClick={() => updateLine(l.id, { pending: true })} className={cn('h-10 rounded-md px-2.5 text-[12.5px] font-semibold', l.pending ? 'bg-warn-soft text-warn-ink' : 'text-ink-3')}>Later</button>
                                </div>
                              </div>
                            )}
                          </div>
                        ))}
                        <div className={cn('flex items-center justify-between rounded-lg px-3 py-2 text-sm font-semibold', cov.covered ? 'bg-success-soft text-success-ink' : 'bg-warn-soft text-warn-ink')} role="status" aria-live="polite">
                          <span>{cov.covered ? (cov.change > 0 ? 'Change due' : 'Fully paid') : cov.overpaidNonCash ? 'Only cash can be over' : 'Still to pay'}</span>
                          <span className="text-lg tabular-nums">{formatMoney(cov.covered ? cov.change : cov.remaining)}</span>
                        </div>
                      </div>
                    )}

                    {method !== 'moniepoint_pos' && !posSaleLocked && (
                      <div className="mt-2 flex flex-wrap gap-2">
                        <Button variant="ghost" className="h-11" onClick={() => (split ? setLines((p) => [...p, newLine(p.some((x) => x.method === 'cash') ? 'transfer' : 'cash', cov.remaining > 0 ? String(cov.remaining) : '')]) : startSplit())}>
                          + Add another payment
                        </Button>
                        {split && <Button variant="ghost" className="h-11" onClick={() => { setSplit(false); chooseMethod('cash'); }}>Single payment</Button>}
                      </div>
                    )}
                  </div>
                </div>
              </div>

              <div className="shrink-0 border-t border-line p-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] sm:px-4">
                {blockers.length > 0 && cart.length > 0 && <p className="m-0 mb-2 text-center text-[12.5px] text-ink-3" role="status">{blockers[0]}</p>}
                {!split && (method === 'transfer' || method === 'card' || method === 'other') ? (
                  <div className="grid grid-cols-2 gap-2">
                    <Button variant="outline" className="h-14" loading={saving} disabled={!canComplete} onClick={() => complete(true)}>Confirm later</Button>
                    <Button className="h-14" loading={saving} disabled={!canComplete} onClick={() => complete(false)}>Payment received <kbd className="ml-1 hidden text-[11px] font-normal opacity-70 min-[900px]:inline">F10</kbd></Button>
                  </div>
                ) : (
                  <Button className="h-14 w-full text-[16px]" loading={saving} disabled={method === 'moniepoint_pos' ? (!posTerminalId || posSaleLocked) : !canComplete} onClick={() => complete(false)}>
                    {method === 'moniepoint_pos' ? `Send ${formatMoney(total)} to POS` : `Complete sale · ${formatMoney(total)}`}
                    <kbd className="ml-1 hidden text-[11px] font-normal opacity-70 min-[900px]:inline">F10</kbd>
                  </Button>
                )}
              </div>
            </>
          )}
        </section>
      </div>

      {/* ---- phone: sticky cart bar above the register tabs ---- */}
      {!sheetOpen && (cart.length > 0 || done) && (
        <button type="button" key={pulse} onClick={() => setSheetOpen(true)}
          className="register-pulse fixed inset-x-3 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-30 flex h-14 items-center justify-between gap-3 rounded-xl bg-contrast px-4 text-white shadow-pop min-[900px]:hidden">
          {done && cart.length === 0
            ? <><span className="text-sm font-semibold">✓ Sale complete</span><span className="inline-flex items-center gap-1 text-sm font-semibold">Receipt <ChevronRightIcon width={16} height={16} /></span></>
            : <><span className="text-sm"><span className="font-semibold">{itemCount}</span> item{itemCount === 1 ? '' : 's'}</span>
              <span className="text-[16px] font-semibold tabular-nums">{formatMoney(total)}</span>
              <span className="inline-flex items-center gap-1 text-sm font-semibold">Charge <ChevronRightIcon width={16} height={16} /></span></>}
        </button>
      )}

      {/* ---- phone: register tabs (Sell · Held · Till · More) ---- */}
      <nav aria-label="Register" className={cn('fixed inset-x-0 bottom-0 z-30 grid h-16 border-t border-line bg-surface pb-[env(safe-area-inset-bottom)] min-[900px]:hidden', cashierSession && !isManagerRole ? 'grid-cols-3' : 'grid-cols-4')}>
        <button type="button" className="flex flex-col items-center justify-center gap-0.5 text-[12px] font-semibold text-brand-ink" aria-current="page" onClick={() => { setSheetOpen(false); window.scrollTo({ top: 0 }); }}>
          <ScanIcon width={22} height={22} />Sell
        </button>
        <button type="button" className="relative flex flex-col items-center justify-center gap-0.5 text-[12px] font-medium text-ink-2" onClick={() => setHeldOpen(true)}>
          <span aria-hidden="true" className="text-lg leading-5">⏸</span>Held
          {held.length > 0 && <span className="absolute right-[calc(50%-22px)] top-1.5 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-brand px-1 text-[11px] font-semibold text-white">{held.length}</span>}
        </button>
        <button type="button" className="flex flex-col items-center justify-center gap-0.5 text-[12px] font-medium text-ink-2" onClick={() => (till.open ? (isManagerRole && !acting ? navigate('/till') : toast.info('The till is open')) : setTillOpen(true))}>
          <span aria-hidden="true" className={cn('size-3 rounded-full', till.open ? 'bg-success' : 'bg-warn')} />Till
        </button>
        {!(cashierSession && !isManagerRole) && (
          <button type="button" className="flex flex-col items-center justify-center gap-0.5 text-[12px] font-medium text-ink-2" onClick={() => (acting ? exitRegister() : navigate('/more'))}>
            <span aria-hidden="true" className="text-lg leading-5">⋯</span>More
          </button>
        )}
      </nav>

      {/* ---- dialogs ---- */}
      {storeId && (
        <>
          <HoldDialog open={holdOpen} defaultLabel={defaultHeldLabel(held.length, selectedCustomer?.name)} onClose={() => { setHoldOpen(false); focusSearch(); }} onHold={holdCurrent} />
          <HeldListDialog open={heldOpen} storeId={storeId} held={held} onClose={() => { setHeldOpen(false); focusSearch(); }} onResume={resumeHeld} />
          <Dialog open={tillOpen} onClose={() => { setTillOpen(false); focusSearch(); }} title="Open the till" description="Count the cash in the drawer to start the day.">
            <TillOpenCard storeId={storeId} onOpened={(t) => { setTill((s) => ({ ...s, open: t })); setTillOpen(false); toast.success('Till open'); focusSearch(); }} />
          </Dialog>
          {override && <ManagerPinDialog open storeId={storeId} action={override.action} reason={override.reason} context={override.context} onClose={() => { setOverride(null); focusSearch(); }} onApproved={override.then} />}
        </>
      )}
      <ShortcutsDialog open={helpOpen} onClose={() => { setHelpOpen(false); focusSearch(); }} />
      <Dialog open={clearOpen} onClose={() => { setClearOpen(false); focusSearch(); }} title="Clear this sale?" description="Every item comes off. Nothing is saved." danger
        footer={<><Button variant="ghost" onClick={() => { setClearOpen(false); focusSearch(); }}>Keep</Button><Button variant="danger" onClick={() => {
          const go = () => { clearSale(); setClearOpen(false); focusSearch(); };
          if (paymentStarted) needOverride('remove_after_payment', 'Payment has started. A manager approves clearing the sale.', go); else go();
        }}>Clear sale</Button></>} />

      {done?.sale && <ReceiptPrint sale={done.sale} storeName={storeName} storeAddress={store?.address} storePhone={store?.phone} cashier={acting?.name} />}
    </div>
  );
}
