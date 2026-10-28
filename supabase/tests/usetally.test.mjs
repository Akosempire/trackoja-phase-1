// TrackOja side of the Usetally connection (docs/USETALLY_CONNECT.md), on a
// throwaway local database: sales are queued once per link, voids follow,
// stock from Usetally invoices is applied once, and app users never see keys.
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
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

export let owner, store, milk, bread;
const link = (storeId = store, biz = 'biz-1') => svc("select public.usetally_save_link($1, $2, 'Shop Ltd', 'NGN', $3, 'enc', 'abcd', null)", [storeId, biz, randomUUID().replace(/-/g, '').padEnd(64, '0')]);
const sell = (items, payments, extra = {}) => as(owner, 'select (public.create_sale($1, $2::jsonb, $3::jsonb, $4, $5, $6)).id', [
  store, JSON.stringify(items), JSON.stringify(payments), extra.name ?? null, extra.phone ?? null, extra.discount ?? 0,
]).then((r) => r.rows[0].id);

test.before(async () => {
  owner = (await one("insert into auth.users(email) values ($1) returning id", [`tk-${Date.now()}@a.test`])).id;
  await pool.query("insert into public.users(id, email, full_name) values ($1, $2, 'Ada') on conflict (id) do nothing", [owner, `tk-${Date.now()}@a.test`]).catch(() => {});
  const r = (await as(owner, "select public.create_onboarding_business('Shop Ltd', 'Ikeja branch', 'general_retail') j")).rows[0].j;
  store = r.store_id;
  // a paying business (billing is tested elsewhere)
  await svc("update public.organizations set billing_status = 'active' where id = (select org_id from public.stores where id = $1)", [store]);
  await svc("update public.organization_products set status = 'active' where org_id = (select org_id from public.stores where id = $1)", [store]).catch(() => {});
  const mk = (name, sku, price, qty) => svc("insert into public.products(store_id, name, sku, selling_price, stock_qty, created_by) values ($1,$2,$3,$4,$5,$6) returning id", [store, name, sku, price, qty, owner]).then((x) => x.rows[0].id);
  milk = await mk('Peak Milk Tin 400g', 'FD-012', 3200, 100);
  bread = await mk('Agege Bread', 'BK-001', 1200, 50);
});
test.after(() => pool.end());

test('no link, nothing queued', async () => {
  const id = await sell([{ productId: milk, quantity: 1 }], [{ method: 'cash', amount: 3200, verificationStatus: 'verified' }]);
  assert.equal((await one('select count(*)::int n from public.usetally_outbox where sale_id = $1', [id])).n, 0);
});

test('a linked store queues each completed sale once, in kobo', async () => {
  await link();
  const id = await sell([{ productId: milk, quantity: 2 }, { productId: bread, quantity: 3 }], [{ method: 'cash', amount: 11000, verificationStatus: 'verified' }], { name: 'Mrs Bisi', phone: '08031112222' });
  const rows = (await svc('select * from public.usetally_outbox where sale_id = $1', [id])).rows;
  assert.equal(rows.length, 1);
  const p = rows[0].payload;
  assert.equal(p.id, id);
  assert.equal(p.currency, 'NGN');
  assert.equal(p.total_minor, 1000000);
  assert.equal(p.items.length, 2);
  assert.equal(p.items.find((i) => i.product_id === milk).unit_price_minor, 320000);
  const paid = p.payments.reduce((s, x) => s + x.amount_minor, 0);
  assert.equal(paid - (p.change_minor ?? 0), 1000000);
  assert.equal(p.customer?.name, 'Mrs Bisi');
});

test('voiding a queued sale queues a void', async () => {
  const id = await sell([{ productId: bread, quantity: 1 }], [{ method: 'cash', amount: 1200, verificationStatus: 'verified' }]);
  await as(owner, "select public.void_sale($1, 'customer changed mind')", [id]);
  const kinds = (await svc('select kind from public.usetally_outbox where sale_id = $1 order by kind', [id])).rows.map((r) => r.kind);
  assert.deepEqual(kinds, ['sale', 'void']);
});

test('app users can read the status but never the key', async () => {
  const s = (await as(owner, 'select public.get_usetally_link_status($1) j', [store])).rows[0].j;
  assert.equal(s.status, 'active');
  assert.equal(s.key_hash, undefined); assert.equal(s.key_enc, undefined);
  await assert.rejects(as(owner, 'select key_enc from public.usetally_links'));
  await assert.rejects(as(owner, "select public.usetally_save_link($1, 'x', 'x', 'NGN', $2, 'e', 'h', null)", [store, '0'.repeat(64)]));
});

test('stock from a paid Usetally invoice is applied once', async () => {
  const doc = randomUUID();
  const before = Number((await one('select stock_qty from public.products where id = $1', [milk])).stock_qty);
  const a = (await svc("select public.usetally_apply_stock($1, $2, 'INV-0042', $3::jsonb) j", [store, doc, JSON.stringify([{ product_id: milk, quantity: 3 }])])).rows[0].j;
  const b = (await svc("select public.usetally_apply_stock($1, $2, 'INV-0042', $3::jsonb) j", [store, doc, JSON.stringify([{ product_id: milk, quantity: 3 }])])).rows[0].j;
  assert.equal(a.applied, true); assert.equal(b.applied, false);
  assert.equal(Number((await one('select stock_qty from public.products where id = $1', [milk])).stock_qty), before - 3);
});

test('claiming leases rows so two runs never send the same sale', async () => {
  const id = await sell([{ productId: bread, quantity: 2 }], [{ method: 'transfer', amount: 2400, verificationStatus: 'verified' }]);
  const first = (await svc('select * from public.usetally_claim_outbox($1, 50)', [store])).rows.map((r) => r.id);
  const second = (await svc('select * from public.usetally_claim_outbox($1, 50)', [store])).rows.map((r) => r.id);
  assert.ok(first.length >= 1);
  assert.equal(second.filter((x) => first.includes(x)).length, 0);
  const row = await one("select id from public.usetally_outbox where sale_id = $1 and kind = 'sale'", [id]);
  await svc("select public.usetally_record_outbox_result($1, 'sent', null, null, 'doc-1')", [row.id]);
  assert.equal((await one('select status from public.usetally_outbox where id = $1', [row.id])).status, 'sent');
});

test('disconnecting stops new sales being queued', async () => {
  await svc("select public.usetally_revoke_link($1, null, 'test')", [store]);
  const id = await sell([{ productId: bread, quantity: 1 }], [{ method: 'cash', amount: 1200, verificationStatus: 'verified' }]);
  assert.equal((await one('select count(*)::int n from public.usetally_outbox where sale_id = $1', [id])).n, 0);
});
