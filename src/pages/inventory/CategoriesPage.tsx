import { useEffect, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { usePermissions } from '../../hooks/usePermissions';
import { CategoryService } from '../../services/category.service';
import { Button } from '../../components/ui/Button';
import { FormField } from '../../components/ui/FormField';
import { PageLoader } from '../../components/ui/PageLoader';
import { Card, CardHead, Empty, Page, PageHeader, cn, inputClass } from '../../components/kit';
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

  const showForm = canCreate || (editingId && canUpdate);
  const parentName = (id?: string) => categories.find((c) => c.id === id)?.name;
  const childCount = (id: string) => categories.filter((c) => c.parentCategoryId === id).length;

  return (
    <Page>
      <PageHeader
        title="Categories"
        subtitle="Organize your products for browsing and filtering."
      />

      {error && <div className="mb-4 rounded-lg bg-danger-soft px-4 py-3 text-sm text-danger" role="alert">{error}</div>}

      <div className="grid gap-4 lg:grid-cols-3 lg:gap-6">
        {showForm && (
          <form onSubmit={handleSubmit} className="min-w-0 lg:col-start-3 lg:row-start-1" aria-labelledby="category-form-title">
            <Card className={cn('lg:sticky lg:top-6', editingId && 'border-brand-line ring-4 ring-brand/10')}>
              <CardHead
                title={<span id="category-form-title">{editingId ? 'Edit category' : 'New category'}</span>}
                hint={editingId ? 'Changes apply to every product in it.' : 'Group similar products together.'}
              />
              <FormField id="category-name" label="Name" value={name} onChange={setName} required placeholder="e.g. Drinks" />
              <FormField
                id="category-description"
                label="Description"
                value={description}
                onChange={setDescription}
                placeholder="Optional"
              />
              <div className="mb-5">
                <label className="mb-1.5 block text-[13px] font-medium text-ink-2" htmlFor="category-parent">
                  Parent category
                </label>
                <select
                  id="category-parent"
                  className={inputClass}
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
              <div className="flex gap-2">
                <Button type="submit" loading={saving} className="flex-1">
                  {editingId ? 'Save changes' : 'Add category'}
                </Button>
                {editingId && (
                  <Button type="button" variant="outline" onClick={resetForm}>
                    Cancel
                  </Button>
                )}
              </div>
            </Card>
          </form>
        )}

        <div className={cn('min-w-0 lg:row-start-1', showForm ? 'lg:col-span-2' : 'lg:col-span-3')}>
          {categories.length === 0 ? (
            <Empty
              title="No categories yet"
              body={showForm ? 'Create a category to make products easier to find and report on.' : 'Categories make products easier to find and report on.'}
            />
          ) : (
            <Card padded={false} className="overflow-hidden" aria-label="All categories">
              <div className="flex items-baseline justify-between gap-3 border-b border-line px-4 py-3 sm:px-5">
                <h2 className="m-0 text-[15px] font-semibold text-ink">All categories</h2>
                <span className="text-[13px] tabular-nums text-ink-3">{categories.length}</span>
              </div>
              <ul className="m-0 list-none divide-y divide-line p-0">
                {categories.map((category) => {
                  const parent = category.parentCategoryId ? parentName(category.parentCategoryId) ?? '—' : null;
                  const children = childCount(category.id);
                  const meta = [
                    category.description,
                    parent && `Sub-category of ${parent}`,
                    children > 0 && `${children} sub-categor${children === 1 ? 'y' : 'ies'}`,
                  ].filter(Boolean).join(' · ');
                  return (
                    <li key={category.id}
                      className={cn('flex items-center gap-3 px-4 py-3 sm:px-5', editingId === category.id && 'bg-brand-soft/50')}>
                      <span aria-hidden="true"
                        className={cn('inline-flex size-10 shrink-0 items-center justify-center rounded-lg text-sm font-semibold',
                          parent ? 'bg-tray text-ink-3' : 'bg-brand-soft text-brand-ink')}>
                        {category.name.charAt(0).toUpperCase()}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="m-0 truncate text-sm font-medium text-ink">{category.name}</p>
                        {meta && <p className="m-0 mt-0.5 truncate text-xs text-ink-3">{meta}</p>}
                      </div>
                      {(canUpdate || canDelete) && (
                        <div className="flex shrink-0 items-center gap-1">
                          {canUpdate && (
                            <Button variant="ghost" className="btn-sm" onClick={() => startEdit(category)}>
                              Edit
                            </Button>
                          )}
                          {canDelete && (
                            <Button variant="ghost" className="btn-sm text-danger hover:text-danger" onClick={() => handleDelete(category.id)}>
                              Delete
                            </Button>
                          )}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            </Card>
          )}
        </div>
      </div>
    </Page>
  );
}
