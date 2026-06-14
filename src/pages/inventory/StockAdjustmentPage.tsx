import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { ProductService } from '../../services/product.service';
import { InventoryService } from '../../services/inventory.service';
import { Button } from '../../components/ui/Button';
import { FormField } from '../../components/ui/FormField';
import { PageLoader } from '../../components/ui/PageLoader';
import type { InventoryMovement, Product } from '../../types';

type AdjustmentMovementType = 'replenishment' | 'transfer_in' | 'transfer_out' | 'adjustment';

const MOVEMENT_LABELS: Record<AdjustmentMovementType, string> = {
  replenishment: 'Replenishment (stock in)',
  transfer_in: 'Transfer in',
  transfer_out: 'Transfer out',
  adjustment: 'Adjustment (stock count correction)',
};

export default function StockAdjustmentPage() {
  const { profile } = useAuth();
  const [searchParams] = useSearchParams();
  const storeId = profile?.currentStoreId;

  const [products, setProducts] = useState<Product[]>([]);
  const [movements, setMovements] = useState<InventoryMovement[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [productId, setProductId] = useState(searchParams.get('productId') ?? '');
  const [movementType, setMovementType] = useState<AdjustmentMovementType>('replenishment');
  const [direction, setDirection] = useState<'increase' | 'decrease'>('increase');
  const [quantity, setQuantity] = useState('');
  const [reason, setReason] = useState('');

  const selectedProduct = products.find((p) => p.id === productId);

  const loadMovements = (pid: string) => {
    if (!storeId || !pid) {
      setMovements([]);
      return;
    }
    InventoryService.getMovements(storeId, { productId: pid, limit: 20 })
      .then(setMovements)
      .catch((err) => console.error('Load movements error:', err));
  };

  useEffect(() => {
    if (!storeId) return;
    setLoading(true);
    ProductService.getProducts(storeId, { lowStockOnly: false })
      .then((all) => {
        const tracked = all.filter((p) => p.trackInventory);
        setProducts(tracked);
        if (!productId && tracked.length > 0) {
          setProductId(tracked[0].id);
        }
      })
      .catch((err) => setError(err.message ?? 'Failed to load products'))
      .finally(() => setLoading(false));
  }, [storeId]);

  useEffect(() => {
    loadMovements(productId);
  }, [storeId, productId]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!storeId || !productId) return;

    const magnitude = Number(quantity);
    if (!magnitude || magnitude <= 0) {
      setError('Enter a quantity greater than zero');
      return;
    }

    let signedQuantity = magnitude;
    if (movementType === 'transfer_out') signedQuantity = -magnitude;
    if (movementType === 'adjustment') signedQuantity = direction === 'decrease' ? -magnitude : magnitude;

    if (movementType === 'adjustment' && !reason.trim()) {
      setError('A reason is required for adjustments');
      return;
    }

    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      await InventoryService.adjustStock(storeId, {
        productId,
        movementType,
        quantity: signedQuantity,
        reason: reason || undefined,
      });
      setSuccess('Stock updated');
      setQuantity('');
      setReason('');
      const updated = await ProductService.getProduct(productId);
      setProducts((prev) => prev.map((p) => (p.id === productId ? updated : p)));
      loadMovements(productId);
    } catch (err: any) {
      setError(err.message ?? 'Failed to record stock movement');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <PageLoader />;

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Adjust stock</h1>
          <p className="page-subtitle">Record replenishments, transfers, and stock corrections.</p>
        </div>
      </div>

      {error && <div className="alert alert-error">{error}</div>}
      {success && <div className="alert alert-success">{success}</div>}

      {products.length === 0 ? (
        <div className="empty-state">No inventory-tracked products yet.</div>
      ) : (
        <>
          <form className="card" onSubmit={handleSubmit}>
            <div className="form-group">
              <label className="form-label" htmlFor="stock-product">
                Product
              </label>
              <select
                id="stock-product"
                className="select-input"
                value={productId}
                onChange={(e) => setProductId(e.target.value)}
              >
                {products.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({p.stockQty} {p.unit})
                  </option>
                ))}
              </select>
            </div>

            {selectedProduct && (
              <p className="page-subtitle" style={{ marginBottom: 16 }}>
                Current stock: <strong style={{ color: 'var(--t1)' }}>{selectedProduct.stockQty} {selectedProduct.unit}</strong>
              </p>
            )}

            <div className="form-group">
              <label className="form-label" htmlFor="stock-movement-type">
                Movement type
              </label>
              <select
                id="stock-movement-type"
                className="select-input"
                value={movementType}
                onChange={(e) => setMovementType(e.target.value as AdjustmentMovementType)}
              >
                {Object.entries(MOVEMENT_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </div>

            {movementType === 'adjustment' && (
              <div className="form-group">
                <label className="form-label" htmlFor="stock-direction">
                  Direction
                </label>
                <select
                  id="stock-direction"
                  className="select-input"
                  value={direction}
                  onChange={(e) => setDirection(e.target.value as 'increase' | 'decrease')}
                >
                  <option value="increase">Increase stock</option>
                  <option value="decrease">Decrease stock</option>
                </select>
              </div>
            )}

            <FormField id="stock-quantity" label="Quantity" type="number" value={quantity} onChange={setQuantity} required />

            <FormField
              id="stock-reason"
              label={movementType === 'adjustment' ? 'Reason (required)' : 'Reason'}
              value={reason}
              onChange={setReason}
              placeholder="Optional note"
            />

            <Button type="submit" loading={saving} className="btn-sm">
              Record movement
            </Button>
          </form>

          <div className="card">
            <p className="list-item-title" style={{ marginBottom: 8 }}>
              Recent movements
            </p>
            {movements.length === 0 ? (
              <p className="page-subtitle">No movements recorded yet.</p>
            ) : (
              movements.map((m) => (
                <div key={m.id} className="movement-row">
                  <div>
                    <div>{MOVEMENT_LABELS[m.movementType as AdjustmentMovementType] ?? m.movementType}</div>
                    {m.reason && <div className="page-subtitle">{m.reason}</div>}
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ color: m.quantity >= 0 ? 'var(--green)' : 'var(--red)' }}>
                      {m.quantity >= 0 ? '+' : ''}
                      {m.quantity}
                    </div>
                    <div className="page-subtitle">{new Date(m.createdAt).toLocaleString()}</div>
                  </div>
                </div>
              ))
            )}
          </div>
        </>
      )}
    </div>
  );
}
