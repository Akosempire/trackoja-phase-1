import { useEffect, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { usePermissions } from '../../hooks/usePermissions';
import { CategoryService } from '../../services/category.service';
import { Button } from '../../components/ui/Button';
import { FormField } from '../../components/ui/FormField';
import { PageLoader } from '../../components/ui/PageLoader';
import type { ProductCategory } from '../../types';

export default function CategoriesPage() {
  const { user, profile } = useAuth();
  const { hasPermission, loading: permsLoading } = usePermissions();
  const storeId = profile?.currentStoreId;

  const [categories, setCategories] = useState<ProductCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [parentId, setParentId] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const canCreate = hasPermission('category:create');
  const canUpdate = hasPermission('category:update');
  const canDelete = hasPermission('category:delete');

  const loadCategories = () => {
    if (!storeId) return;
    setLoading(true);
    CategoryService.getCategories(storeId)
      .then(setCategories)
      .catch((err) => setError(err.message ?? 'Failed to load categories'))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadCategories();
  }, [storeId]);

  const resetForm = () => {
    setName('');
    setDescription('');
    setParentId('');
    setEditingId(null);
  };

  const startEdit = (category: ProductCategory) => {
    setEditingId(category.id);
    setName(category.name);
    setDescription(category.description ?? '');
    setParentId(category.parentCategoryId ?? '');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!storeId || !user) return;

    setSaving(true);
    setError(null);
    try {
      if (editingId) {
        await CategoryService.updateCategory(editingId, {
          name,
          description: description || undefined,
          parentCategoryId: parentId || null,
        });
      } else {
        await CategoryService.createCategory(storeId, user.id, {
          name,
          description: description || undefined,
          parentCategoryId: parentId || undefined,
        });
      }
      resetForm();
      loadCategories();
    } catch (err: any) {
      setError(err.message ?? 'Failed to save category');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (categoryId: string) => {
    if (!confirm('Delete this category? Products in it will become uncategorized.')) return;
    setError(null);
    try {
      await CategoryService.deleteCategory(categoryId);
      if (editingId === categoryId) resetForm();
      loadCategories();
    } catch (err: any) {
      setError(err.message ?? 'Failed to delete category');
    }
  };

  if (loading || permsLoading) return <PageLoader />;

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Categories</h1>
          <p className="page-subtitle">Organize your products for browsing and filtering.</p>
        </div>
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      {(canCreate || (editingId && canUpdate)) && (
        <form className="card" onSubmit={handleSubmit}>
          <FormField id="category-name" label="Name" value={name} onChange={setName} required />
          <FormField
            id="category-description"
            label="Description"
            value={description}
            onChange={setDescription}
            placeholder="Optional"
          />
          <div className="form-group">
            <label className="form-label" htmlFor="category-parent">
              Parent category
            </label>
            <select
              id="category-parent"
              className="select-input"
              value={parentId}
              onChange={(e) => setParentId(e.target.value)}
            >
              <option value="">None</option>
              {categories
                .filter((c) => c.id !== editingId)
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
            </select>
          </div>
          <div className="btn-row">
            <Button type="submit" loading={saving} className="btn-sm">
              {editingId ? 'Save changes' : 'Add category'}
            </Button>
            {editingId && (
              <Button type="button" variant="ghost" onClick={resetForm} className="btn-sm">
                Cancel
              </Button>
            )}
          </div>
        </form>
      )}

      {categories.length === 0 ? (
        <div className="empty-state">No categories yet.</div>
      ) : (
        <div className="list">
          {categories.map((category) => (
            <div key={category.id} className="list-item">
              <div>
                <p className="list-item-title">{category.name}</p>
                {category.description && <p className="list-item-subtitle">{category.description}</p>}
                {category.parentCategoryId && (
                  <p className="list-item-subtitle">
                    Sub-category of {categories.find((c) => c.id === category.parentCategoryId)?.name ?? '—'}
                  </p>
                )}
              </div>
              <div className="btn-row">
                {canUpdate && (
                  <Button variant="ghost" className="btn-sm" onClick={() => startEdit(category)}>
                    Edit
                  </Button>
                )}
                {canDelete && (
                  <Button variant="ghost" className="btn-sm" onClick={() => handleDelete(category.id)}>
                    Delete
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
