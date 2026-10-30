// Privacy & data, the daily email and time in the app, on a throwaway local
// database: who may export, schedule and cancel deletion, purge, delete an
// account, and read usage.
import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';

const pool = new pg.Pool();
const one = async (sql, p = []) => (await pool.query(sql, p)).rows[0];
async function as(userId, sql, p = []) {
  const c = await pool.connect();
  try {
    await c.query('begin');
    await c.query('set local role authenticated');
    await c.query("select set_config('request.jwt.claim.sub', $1, true)", [userId]);
    const r = await c.query(sql, p);
    await c.query('commit');
    return r;
  } catch (e) { await c.query('rollback'); throw e; } finally { c.release(); }
}
const svc = (sql, p = []) => pool.query(sql, p);
const user = async (tag) => {
  const email = `${tag}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@a.test`;
  return (await one('insert into auth.users(email) values ($1) returning id', [email])).id;
};
async function business(owner, name) {
  const r = (await as(owner, "select public.create_onboarding_business($1, 'Main branch', 'general_retail') j", [name])).rows[0].j;
  await svc("update public.organizations set billing_status = 'active' where id = $1", [r.org_id]);
  await svc("update public.organization_products set status = 'active', expires_at = null where org_id = $1", [r.org_id]);
  return r;
}

let ada, kemi, admin, shop, other;
test.before(async () => {
  ada = await user('ada'); kemi = await user('kemi'); admin = await user('admin');
  shop = await business(ada, 'Ada Stores');
  other = await business(kemi, 'Kemi Mart');
  await svc("insert into public.platform_admins(user_id, level, status) values ($1, 'super_admin', 'active')", [admin]);
  await svc("update public.users set first_name = 'Ada' where id = $1", [ada]);
});
test.after(() => pool.end());

test('only owners and managers download a store\'s data', async () => {
  await svc("insert into public.products(store_id, name, sku, selling_price, stock_qty, reorder_level, created_by) values ($1, 'Rice 5kg', 'R5', 9000, 2, 5, $2)", [shop.store_id, ada]);
  const data = (await as(ada, 'select public.export_store_data($1) j', [shop.store_id])).rows[0].j;
  assert.equal(data.store.id, shop.store_id);
  assert.equal(data.products.length, 1);
  assert.ok(Array.isArray(data.sales));
  await assert.rejects(as(kemi, 'select public.export_store_data($1)', [shop.store_id]), /owner or manager/);
  assert.equal((await one("select count(*)::int n from public.audit_logs where action = 'DATA_EXPORTED' and store_id = $1", [shop.store_id])).n, 1);
});

test('the daily email lists low stock for opted-in stores, once a day', async () => {
  const day = (await one("select ((now() at time zone 'Africa/Lagos')::date - 1) d")).d;
  let rows = (await svc('select public.daily_digest_data(null) j')).rows[0].j;
  const mine = rows.find((r) => r.store_id === shop.store_id);
  assert.ok(mine, 'store with low stock is included');
  assert.equal(mine.low_stock[0].name, 'Rice 5kg');
  assert.ok(mine.recipients.length >= 1);
  assert.equal(rows.some((r) => r.store_id === other.store_id), false, 'nothing to report = no email');
  await svc('select public.record_digest_sent($1, $2, 1)', [shop.store_id, day]);
  rows = (await svc('select public.daily_digest_data(null) j')).rows[0].j;
  assert.equal(rows.some((r) => r.store_id === shop.store_id), false, 'not twice for the same day');
  await as(ada, 'select public.set_daily_email($1, false)', [shop.store_id]);
  assert.equal((await as(ada, 'select public.get_daily_email($1) v', [shop.store_id])).rows[0].v, false);
  await assert.rejects(as(kemi, 'select public.set_daily_email($1, true)', [shop.store_id]), /owner or manager/);
  await assert.rejects(as(ada, 'select public.daily_digest_data(null)'));
});

test('deleting a business: owner only, typed name, 30 days, can cancel', async () => {
  await assert.rejects(as(kemi, "select public.request_business_deletion($1, 'Ada Stores')", [shop.org_id]), /owner/);
  await assert.rejects(as(ada, "select public.request_business_deletion($1, 'Ada Store')", [shop.org_id]), /exactly/);
  const due = (await as(ada, "select public.request_business_deletion($1, ' ada stores ') d", [shop.org_id])).rows[0].d;
  assert.ok(new Date(due) - Date.now() > 29 * 86400000);
  assert.equal((await as(ada, 'select public.get_business_deletion($1) j', [shop.org_id])).rows[0].j.owner, true);
  await as(ada, 'select public.cancel_business_deletion($1)', [shop.org_id]);
  assert.equal((await one('select deletion_due_at from public.organizations where id = $1', [shop.org_id])).deletion_due_at, null);
  assert.equal((await svc('select public.purge_due_businesses() n')).rows[0].n, 0);
});

test('a business is purged only after its date, with everything in it', async () => {
  const bo = await user('bo');
  const gone = await business(bo, 'Old Shop');
  await svc("insert into public.products(store_id, name, sku, selling_price, stock_qty, created_by) values ($1, 'Soap', 'S1', 500, 10, $2)", [gone.store_id, bo]);
  const soap = (await one("select id from public.products where store_id = $1", [gone.store_id])).id;
  await as(bo, "select public.create_sale($1, $2::jsonb, $3::jsonb)", [gone.store_id, JSON.stringify([{ productId: soap, quantity: 2 }]), JSON.stringify([{ method: 'cash', amount: 1000, verificationStatus: 'verified' }])]);
  await svc("insert into public.customers(store_id, name, created_by) values ($1, 'Mama T', $2)", [gone.store_id, bo]);
  await svc("insert into public.expenses(store_id, description, category, amount, recorded_by) values ($1, 'Diesel', 'utilities', 5000, $2)", [gone.store_id, bo]).catch(() => {});
  await as(bo, "select public.request_business_deletion($1, 'Old Shop')", [gone.org_id]);
  assert.equal((await svc('select public.purge_due_businesses() n')).rows[0].n, 0);
  await svc("update public.organizations set deletion_due_at = now() - interval '1 minute' where id = $1", [gone.org_id]);
  assert.equal((await svc('select public.purge_due_businesses() n')).rows[0].n, 1);
  assert.equal((await one('select count(*)::int n from public.stores where id = $1', [gone.store_id])).n, 0);
  assert.equal((await one('select count(*)::int n from public.products where store_id = $1', [gone.store_id])).n, 0);
  assert.equal((await one('select count(*)::int n from public.sales where store_id = $1', [gone.store_id])).n, 0);
  assert.equal((await one('select count(*)::int n from public.customers where store_id = $1', [gone.store_id])).n, 0);
  assert.equal((await one('select name from public.business_deletions where org_id = $1', [gone.org_id])).name, 'Old Shop');
  assert.equal((await one('select count(*)::int n from public.organizations where id = $1', [other.org_id])).n, 1, 'other businesses untouched');
});

test('deleting an account: refused for an owner, scrubs a staff member', async () => {
  await assert.rejects(as(ada, 'select public.prepare_account_deletion()'), /own Ada Stores/);
  const staff = await user('staff');
  const role = (await one("select id from public.roles where name = 'cashier' or name = 'staff' order by is_system desc limit 1"))?.id
    ?? (await one("select id from public.roles order by created_at limit 1")).id;
  await svc("insert into public.store_members(store_id, user_id, role_id, status) values ($1, $2, $3, 'active')", [shop.store_id, staff, role]);
  await as(staff, 'select public.prepare_account_deletion()');
  const u = await one('select email, first_name, status from public.users where id = $1', [staff]);
  assert.match(u.email, /@deleted\.invalid$/);
  assert.equal(u.status, 'inactive');
  assert.equal((await one('select count(*)::int n from public.store_members where user_id = $1', [staff])).n, 0);
});

test('time in the app: members only, capped, admins not counted, only admins read it', async () => {
  await as(ada, "select public.usage_add($1, '/sales/checkout', 60)", [shop.store_id]);
  await as(ada, "select public.usage_add($1, '/sales/checkout', 9999)", [shop.store_id]);
  await as(ada, "select public.usage_add($1, '/<bad>', 60)", [shop.store_id]);
  await as(ada, "select public.usage_add($1, '/dashboard', 60)", [other.store_id]);
  await as(admin, "select public.usage_add($1, '/dashboard', 60)", [shop.store_id]);
  const rows = (await svc('select area, seconds from public.usage_daily where store_id in ($1, $2)', [shop.store_id, other.store_id])).rows;
  assert.deepEqual(rows.map((r) => [r.area, r.seconds]), [['/sales/checkout', 360]]);
  await assert.rejects(as(ada, 'select * from public.usage_daily'));
  await assert.rejects(as(ada, 'select public.get_platform_usage(30)'));
  const all = (await as(admin, 'select public.get_platform_usage(30) j', [])).rows[0].j;
  assert.ok(all.some((r) => r.store === 'Main branch' && r.business === 'Ada Stores' && r.seconds === 360));
});
