import { updateListFilter } from '../../../utils/list-filters';
import { SearchInput } from '../../../components/ui/SearchInput';
import { Card, btn } from '../../../components/kit';
import { tableBleed } from '../../../components/platform/ui';
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
    const next = updateListFilter(searchParams, key, value);
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
            <Link className="font-medium text-ink no-underline break-words hover:text-brand-ink hover:underline" to={`/platform/businesses/${row.orgId}`}>
              {row.name}
            </Link>
            <p className="m-0 text-xs text-ink-3 break-words">{row.ownerEmail ?? 'No owner email'}</p>
            <p className="m-0 text-xs text-ink-3 break-words">{categoryLabel(row.businessCategory)}</p>
          </div>
        ),
      },
      {
        key: 'plan',
        header: 'Plan',
        sortValue: (row) => row.planName ?? '',
        render: (row) => (
          <div>
            <span className="font-medium text-ink break-words">{row.planName ?? 'No plan'}</span>
            <p className="m-0 text-xs text-ink-3 break-words">{row.productName}</p>
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
            <p className="m-0 text-xs text-ink-3 break-words">Billing: {row.billingStatus ?? '—'}</p>
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
            <span className="font-medium text-ink break-words">{formatNumber(row.seatUsed)}</span>
            <p className="m-0 text-xs text-ink-3 break-words">of {formatSeatLimit(row.agreedUserLimit)}</p>
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
            return <span className="m-0 block text-xs text-ink-3 break-words">{row.trialEndsAt ? 'Trial' : 'No expiry set'}</span>;
          }
          return (
            <div>
              <span className="font-medium text-ink whitespace-nowrap">{formatDate(row.expiresAt)}</span>
              <p className="m-0 text-xs text-ink-3 break-words">
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
            <span className="font-medium text-ink whitespace-nowrap">{formatDate(row.createdAt)}</span>
            <p className="m-0 text-xs text-ink-3 whitespace-nowrap">{formatRelative(row.createdAt)}</p>
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

      <Card aria-labelledby="businesses-title">
        <SectionHead id="businesses-title" title={`Businesses${visibleRows.length > 0 ? ` (${visibleRows.length})` : ''}`} sub="Find a business by name, owner email or slug, then open it for detail." />

        <form
          className="grid grid-cols-1 items-start gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,2fr)_repeat(3,minmax(0,1fr))_auto]"
          onSubmit={(event) => {
            event.preventDefault();
            setFilter('q', searchDraft.trim());
          }}
        >
          <div className="flex min-w-0 flex-col gap-1.5 sm:col-span-2 lg:col-span-1">
            <label className="text-[13px] font-medium text-ink-2" htmlFor="business-search">
              Search businesses
            </label>
            <SearchInput className="mb-0" aria-label="Search businesses"
              id="business-search"
              value={searchDraft}
              placeholder="Name, owner email or slug"
              onChange={(event) => setSearchDraft(event.target.value)}
            />
          </div>

          <div className="flex min-w-0 flex-col gap-1.5">
            <label className="text-[13px] font-medium text-ink-2" htmlFor="business-product">
              Product
            </label>
            <select
              id="business-product"
              className="block h-10 w-full min-w-0 rounded-md border border-line-strong bg-surface px-3 text-sm text-ink placeholder:text-ink-3 focus:border-brand focus:outline-none focus:ring-4 focus:ring-brand/15 cursor-pointer pr-8"
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

          <div className="flex min-w-0 flex-col gap-1.5">
            <label className="text-[13px] font-medium text-ink-2" htmlFor="business-access">
              Access status
            </label>
            <select
              id="business-access"
              className="block h-10 w-full min-w-0 rounded-md border border-line-strong bg-surface px-3 text-sm text-ink placeholder:text-ink-3 focus:border-brand focus:outline-none focus:ring-4 focus:ring-brand/15 cursor-pointer pr-8"
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

          <div className="flex min-w-0 flex-col gap-1.5">
            <label className="text-[13px] font-medium text-ink-2" htmlFor="business-billing">
              Billing status
            </label>
            <select
              id="business-billing"
              className="block h-10 w-full min-w-0 rounded-md border border-line-strong bg-surface px-3 text-sm text-ink placeholder:text-ink-3 focus:border-brand focus:outline-none focus:ring-4 focus:ring-brand/15 cursor-pointer pr-8"
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

          <div className="flex gap-2 sm:col-span-2 lg:col-span-1 lg:pt-[25px]">
          <button type="submit" className={btn('primary')}>
            Search
          </button>

          {filtersActive && (
            <button
              type="button"
              className={btn('ghost')}
              onClick={() => {
                setSearchDraft('');
                setSearchParams(new URLSearchParams(), { replace: true });
              }}
            >
              Clear filters
            </button>
          )}
          </div>
        </form>
        {billing && (
          <p className="m-0 mt-3 text-xs text-ink-3">
            Billing status is filtered in this browser, so a page can show fewer rows than the page size.
          </p>
        )}
        <div className="mt-5">
        {error ? (
          <StateBlock
            variant="error"
            title="Could not load businesses"
            body={error}
            actions={
              <button type="button" className={btn('outline', 'sm')} onClick={load}>
                Try again
              </button>
            }
          />
        ) : (
          <>
            <div className={tableBleed}>
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
            </div>
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
        </div>
      </Card>

      {/* Platform accounts live in this area because it is the one named for
          users; the ten-area structure deliberately does not gain an eleventh.
          The component renders nothing unless the operator can manage users. */}
      <PlatformRolesSection />
    </>
  );
}
