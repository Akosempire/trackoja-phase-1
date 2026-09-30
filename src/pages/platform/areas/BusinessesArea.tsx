import { SearchInput } from '../../../components/ui/SearchInput';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { PlatformAdminService, type ProductBusiness, type PlatformProduct } from '../../../services/platformAdmin.service';
import { usePlatform } from '../../../components/platform/PlatformContext';
import { AreaCoverage, PermissionDenied, PlatformPageHead, RefreshButton } from '../../../components/platform/PlatformPageHead';
import { PlatformRolesSection } from '../../../components/platform/PlatformRolesSection';
import { DataTable, type DataTableColumn } from '../../../components/ui/DataTable';
import { Pagination } from '../../../components/ui/Pagination';
import { SectionHead } from '../../../components/ui/SectionHead';
import { StatusBadge } from '../../../components/ui/StatusBadge';
import { StateBlock } from '../../../components/ui/StateBlock';
import { Badge } from '../../../components/ui/Badge';
import { PLATFORM_AREAS } from '../../../config/platformAreas';
import { CATEGORY_CONFIGS } from '../../../config/businessModules';
import { daysUntil, formatDate, formatNumber, formatRelative, formatSeatLimit } from '../../../utils/format';

const AREA = PLATFORM_AREAS.find((area) => area.id === 'businesses')!;

const ENTITLEMENT_STATUSES = ['active', 'pending', 'past_due', 'suspended', 'expired', 'cancelled'] as const;
const BILLING_STATUSES = ['trial', 'active', 'past_due', 'suspended', 'cancelled'] as const;

const PAGE_SIZE = 25;

function categoryLabel(category: string): string {
  const config = CATEGORY_CONFIGS[category as keyof typeof CATEGORY_CONFIGS];
  return config?.label ?? category.replace(/_/g, ' ');
}

export default function BusinessesArea() {
  const navigate = useNavigate();
  const { can } = usePlatform();
  const [searchParams, setSearchParams] = useSearchParams();

  // Filters live in the URL so a metric on the Overview can link straight to a
  // filtered list, and so an operator can share what they are looking at.
  const search = searchParams.get('q') ?? '';
  const status = searchParams.get('status') ?? '';
  const billing = searchParams.get('billing') ?? '';
  const productKey = searchParams.get('product') ?? '';
  const page = Math.max(1, Number(searchParams.get('page') ?? '1') || 1);

  const [searchDraft, setSearchDraft] = useState(search);
  const [rows, setRows] = useState<ProductBusiness[]>([]);
  const [products, setProducts] = useState<PlatformProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const allowed = can('platform:manage_businesses');

  const load = useCallback(async () => {
    if (!allowed) return;
    setLoading(true);
    setError(null);
    try {
      setRows(
        await PlatformAdminService.listBusinesses({
          productKey: productKey || undefined,
          search: search || undefined,
          status: status || undefined,
          limit: PAGE_SIZE,
          offset: (page - 1) * PAGE_SIZE,
        }),
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not load businesses.');
    } finally {
      setLoading(false);
    }
  }, [allowed, page, productKey, search, status]);

  useEffect(() => {
    void load();
  }, [load]);

  // The product filter options change only with the product catalogue, so they
  // load once rather than on every page or filter change.
  useEffect(() => {
    if (!allowed) return;
    let cancelled = false;
    PlatformAdminService.listProducts()
      .then((list) => {
        if (!cancelled) setProducts(list);
      })
      .catch(() => {
        // Without this list the filter offers "All products" only, which is
        // still a working screen.
        if (!cancelled) setProducts([]);
      });
    return () => {
      cancelled = true;
    };
  }, [allowed]);

  /** Applies a filter and resets to page one, since offsets shift under it. */
  function setFilter(key: string, value: string) {
    const next = new URLSearchParams(searchParams);
    if (value) next.set(key, value);
    else next.delete(key);
    next.delete('page');
    setSearchParams(next, { replace: true });
  }

  // Billing status is not a filter the backend accepts, so it is applied here
  // and the narrowing is stated in the UI rather than silently truncating.
  const visibleRows = useMemo(
    () => (billing ? rows.filter((row) => row.billingStatus === billing) : rows),
    [rows, billing],
  );

  const columns = useMemo<DataTableColumn<ProductBusiness>[]>(
    () => [
      {
        key: 'name',
        header: 'Business',
        label: '',
        sortValue: (row) => row.name.toLowerCase(),
        render: (row) => (
          <div>
            <Link className="data-table-primary" to={`/platform/businesses/${row.orgId}`}>
              {row.name}
            </Link>
            <p className="data-table-secondary">{row.ownerEmail ?? 'No owner email'}</p>
            <p className="data-table-secondary">{categoryLabel(row.businessCategory)}</p>
          </div>
        ),
      },
      {
        key: 'plan',
        header: 'Plan',
        sortValue: (row) => row.planName ?? '',
        render: (row) => (
          <div>
            <span className="data-table-primary">{row.planName ?? 'No plan'}</span>
            <p className="data-table-secondary">{row.productName}</p>
          </div>
        ),
      },
      {
        key: 'status',
        header: 'Access',
        sortValue: (row) => row.entitlementStatus,
        render: (row) => (
          <div>
            <StatusBadge status={row.entitlementStatus} />
            {row.isSandbox && (
              <>
                {' '}
                <Badge tone="workspace">sandbox</Badge>
              </>
            )}
            <p className="data-table-secondary">Billing: {row.billingStatus ?? '—'}</p>
          </div>
        ),
      },
      {
        key: 'seats',
        header: 'Seats',
        numeric: true,
        sortValue: (row) => row.seatUsed,
        render: (row) => (
          <div>
            <span className="data-table-primary">{formatNumber(row.seatUsed)}</span>
            <p className="data-table-secondary">of {formatSeatLimit(row.agreedUserLimit)}</p>
          </div>
        ),
      },
      {
        key: 'expiry',
        header: 'Expires',
        sortValue: (row) => row.expiresAt ?? '',
        render: (row) => {
          const days = daysUntil(row.expiresAt);
          if (row.expiresAt === null) {
            return <span className="data-table-secondary">{row.trialEndsAt ? 'Trial' : 'No expiry set'}</span>;
          }
          return (
            <div>
              <span className="data-table-primary">{formatDate(row.expiresAt)}</span>
              <p className="data-table-secondary">
                {days !== null && days < 0
                  ? `Expired ${formatRelative(row.expiresAt)}`
                  : days !== null && days <= 30
                    ? `${days} days left`
                    : formatRelative(row.expiresAt)}
              </p>
            </div>
          );
        },
      },
      {
        key: 'stores',
        header: 'Stores',
        numeric: true,
        sortValue: (row) => row.storeCount,
        render: (row) => formatNumber(row.storeCount),
      },
      {
        key: 'created',
        header: 'Signed up',
        sortValue: (row) => row.createdAt,
        render: (row) => (
          <div>
            <span className="data-table-primary">{formatDate(row.createdAt)}</span>
            <p className="data-table-secondary">{formatRelative(row.createdAt)}</p>
          </div>
        ),
      },
    ],
    [],
  );

  if (!allowed) {
    return (
      <>
        <PlatformPageHead area={AREA} />
        <PermissionDenied what="the business directory" permission="platform:manage_businesses" />
      </>
    );
  }

  const filtersActive = Boolean(search || status || billing || productKey);

  return (
    <>
      <PlatformPageHead
        area={AREA}
        actions={<RefreshButton onClick={load} loading={loading} />}
      />

      <AreaCoverage gaps={AREA.gaps} title="What this page cannot do yet" />

      <section className="card">
        <SectionHead title="Find a business" />

        <form
          className="toolbar"
          onSubmit={(event) => {
            event.preventDefault();
            setFilter('q', searchDraft.trim());
          }}
        >
          <div className="toolbar-grow">
            <label className="form-label" htmlFor="business-search">
              Search businesses
            </label>
            <SearchInput aria-label="Search businesses"
              id="business-search"


              value={searchDraft}
              placeholder="Name, owner email or slug"
              onChange={(event) => setSearchDraft(event.target.value)}
            />
          </div>

          <div className="plat-field">
            <label className="form-label" htmlFor="business-product">
              Product
            </label>
            <select
              id="business-product"
              className="select-input"
              value={productKey}
              onChange={(event) => setFilter('product', event.target.value)}
            >
              <option value="">All products</option>
              {products.map((product) => (
                <option key={product.key} value={product.key}>
                  {product.name}
                </option>
              ))}
            </select>
          </div>

          <div className="plat-field">
            <label className="form-label" htmlFor="business-access">
              Access status
            </label>
            <select
              id="business-access"
              className="select-input"
              value={status}
              onChange={(event) => setFilter('status', event.target.value)}
            >
              <option value="">Any access status</option>
              {ENTITLEMENT_STATUSES.map((value) => (
                <option key={value} value={value}>
                  {value.replace(/_/g, ' ')}
                </option>
              ))}
            </select>
          </div>

          <div className="plat-field">
            <label className="form-label" htmlFor="business-billing">
              Billing status
            </label>
            <select
              id="business-billing"
              className="select-input"
              value={billing}
              onChange={(event) => setFilter('billing', event.target.value)}
            >
              <option value="">Any billing status</option>
              {BILLING_STATUSES.map((value) => (
                <option key={value} value={value}>
                  {value.replace(/_/g, ' ')}
                </option>
              ))}
            </select>
          </div>

          <button type="submit" className="btn btn-neutral btn-sm">
            <span className="btn-label">Search</span>
          </button>

          {filtersActive && (
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => {
                setSearchDraft('');
                setSearchParams(new URLSearchParams(), { replace: true });
              }}
            >
              <span className="btn-label">Clear filters</span>
            </button>
          )}
        </form>

        {billing && (
          <p className="form-hint">
            Billing status is filtered in this browser, so a page can show fewer rows than the page size.
          </p>
        )}
      </section>

      <section className="card">
        <SectionHead title={`Businesses${visibleRows.length > 0 ? ` (${visibleRows.length})` : ''}`} />

        {error ? (
          <StateBlock
            variant="error"
            title="Could not load businesses"
            body={error}
            actions={
              <button type="button" className="btn btn-outline btn-sm" onClick={load}>
                <span className="btn-label">Try again</span>
              </button>
            }
          />
        ) : (
          <>
            <DataTable
              columns={columns}
              rows={visibleRows}
              rowKey={(row) => row.orgId}
              stacked
              loading={loading}
              caption="Customer businesses"
              onRowClick={(row) => navigate(`/platform/businesses/${row.orgId}`)}
              empty={
                <StateBlock
                  variant="empty"
                  title={filtersActive ? 'No businesses match these filters' : 'No businesses yet'}
                  body={filtersActive ? 'Clear the filters or widen the search.' : undefined}
                />
              }
            />
            <Pagination
              page={page}
              pageSize={PAGE_SIZE}
              total={null}
              noun="businesses"
              hasNext={rows.length === PAGE_SIZE}
              onPageChange={(next) => setFilter('page', String(next))}
            />
          </>
        )}
      </section>

      {/* Platform accounts live in this area because it is the one named for
          users; the ten-area structure deliberately does not gain an eleventh.
          The component renders nothing unless the operator can manage users. */}
      <PlatformRolesSection />
    </>
  );
}
