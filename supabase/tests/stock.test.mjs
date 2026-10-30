// Restocking, stock counts, branch transfers and low stock
// (20261030002001_restock_counts_transfers.sql), on a throwaway local database.
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
const qty = async (id) => Number((await one('select stock_qty from public.products where id=$1', [id])).stock_qty);
const cost = async (id) => Number((await one('select cost_price from public.products where id=$1', [id])).cost_price);

let owner, cashier, outsider, store, branch, otherStore, rice, milk, supplier;
async function user(tag) {
  const s = `${tag}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@stock.test`;
  const id = (await one('insert into auth.users(email) values ($1) returning id', [s])).id;
  await pool.query("insert into public.users(id, email) values ($1, $2) on conflict (id) do nothing", [id, s]).catch(() => {});
  return id;
}
async function business(u, name) {
  const r = (await as(u, "select public.create_onboarding_business($1, $2, 'general_retail') j", [name, `${name} Ikeja`])).rows[0].j;
  await pool.query("update public.organizations set billing_status = 'active' where id = (select org_id from public.stores where id = $1)", [r.store_id]);
  // a paying business (billing is tested elsewhere)
  await pool.query("update public.organization_products set status = 'active', expires_at = null where org_id = (select org_id from public.stores where id = $1)", [r.store_id]);
  return r.store_id;
}
const product = (s, name, sku, price, cost, stock, reorder = 0) => pool.query(
  'insert into public.products(store_id, name, sku, selling_price, cost_price, stock_qty, reorder_level, created_by) values ($1,$2,$3,$4,$5,$6,$7,(select created_by from public.stores where id=$1)) returning id',
  [s, name, sku, price, cost, stock, reorder]).then((r) => r.rows[0].id);

test.before(async () => {
  owner = await user('owner'); cashier = await user('cashier'); outsider = await user('outsider');
  store = await business(owner, 'Ada Stores');
  otherStore = await business(outsider, 'Bo Stores');
  // a second branch of Ada's business
  branch = (await one(`insert into public.stores(org_id, name, slug, created_by, status, currency)
    select org_id, 'Ada Yaba', 'ada-yaba-' || substr(md5(random()::text), 1, 6), created_by, 'active', 'NGN' from public.stores where id = $1 returning id`, [store])).id;
  await pool.query(`insert into public.store_members(store_id, user_id, role_id, status, accepted_at)
    select $1, $2, id, 'active', now() from public.roles where name = 'owner' and is_system order by created_at limit 1`, [branch, owner]);
  await pool.query(`insert into public.store_members(store_id, user_id, role_id, status, accepted_at)
    select $1, $2, id, 'active', now() from public.roles where name = 'cashier' and is_system order by created_at limit 1`, [store, cashier]);
  rice = await product(store, 'Rice 5kg', 'RICE5', 9000, 7000, 10, 4);
  milk = await product(store, 'Peak Milk', 'MILK', 400, 300, 2, 6);
  supplier = (await as(owner, "select (public.create_supplier($1, 'Dangote Foods', 'Musa', '0803', null, null, '30 days', null)).id", [store])).rows[0].id;
});
test.after(() => pool.end());

test('receiving a delivery raises stock and moves cost to the weighted average', async () => {
  const p = (await as(owner, "select * from public.receive_purchase($1, $2::jsonb, $3, null, 'transfer', 'INV-77', null, 50000)",
    [store, JSON.stringify([{ productId: rice, quantity: 10, unitCost: 8000 }, { productId: milk, quantity: 24, unitCost: 320 }]), supplier])).rows[0];
  assert.equal(Number(p.total), 10 * 8000 + 24 * 320);
  assert.equal(Number(p.amount_paid), 50000);
  assert.equal(await qty(rice), 20);
  assert.equal(await cost(rice), 7500); // (10 x 7000 + 10 x 8000) / 20
  assert.equal(await qty(milk), 26);
  const mv = await one("select count(*)::int n from public.inventory_movements where source_type='purchase' and source_id=$1", [p.id]);
  assert.equal(mv.n, 2);
  assert.ok(p.expense_id, 'the cost shows in Expenses');
});

test('supplier balance, later payments oldest first, never more than owed', async () => {
  let s = (await as(owner, 'select * from public.list_supplier_balances($1)', [store])).rows.find((r) => r.id === supplier);
  assert.equal(Number(s.owed), 87680 - 50000);
  await assert.rejects(as(owner, "select public.record_supplier_payment($1, $2, 999999)", [store, supplier]), /more than you owe/);
  await as(owner, "select public.record_supplier_payment($1, $2, 30000, null, 'cash')", [store, supplier]);
  s = (await as(owner, 'select * from public.list_supplier_balances($1)', [store])).rows.find((r) => r.id === supplier);
  assert.equal(Number(s.owed), 7680);
  const d = (await as(owner, 'select public.get_purchase_detail(id) j from public.purchases where supplier_id=$1 limit 1', [supplier])).rows[0].j;
  assert.equal(d.items.length, 2); assert.equal(d.payments.length, 2);
});

test('a credit delivery is owed in full; cashiers and other businesses cannot receive or see it', async () => {
  const p = (await as(owner, "select * from public.receive_purchase($1, $2::jsonb, $3, null, 'credit')",
    [store, JSON.stringify([{ productId: milk, quantity: 1, unitCost: 300 }]), supplier])).rows[0];
  assert.equal(Number(p.amount_paid), 0);
  await assert.rejects(as(cashier, 'select public.receive_purchase($1, $2::jsonb)', [store, JSON.stringify([{ productId: milk, quantity: 1, unitCost: 1 }])]), /Permission denied/);
  await assert.rejects(as(outsider, 'select public.receive_purchase($1, $2::jsonb)', [store, JSON.stringify([{ productId: milk, quantity: 1, unitCost: 1 }])]), /Permission denied/);
  await assert.rejects(as(outsider, 'select * from public.list_purchase_history($1)', [store]), /Permission denied/);
  assert.equal((await as(outsider, 'select id from public.purchases where id=$1', [p.id])).rowCount, 0);
  await assert.rejects(as(owner, 'select public.receive_purchase($1, $2::jsonb)', [store, JSON.stringify([{ productId: await product(otherStore, 'X', 'X1', 1, 1, 0), quantity: 1, unitCost: 1 }])]), /not in this store/);
});

test('a stock count applies counted minus expected, keeping sales made meanwhile', async () => {
  const c = (await as(owner, 'select * from public.start_stock_count($1)', [store])).rows[0];
  await assert.rejects(as(owner, 'select public.start_stock_count($1)', [store]), /already open/);
  const before = await qty(rice); // 20
  await as(owner, 'select public.set_stock_count_line($1, $2, $3)', [c.id, rice, before - 3]);
  // a sale of 1 happens while counting
  await pool.query("select public._apply_inventory_movement_internal($1, $2, 'sale', -1, 'test sale', 'sale', null, $3)", [store, rice, owner]);
  const r = (await as(owner, 'select public.apply_stock_count($1) j', [c.id])).rows[0].j;
  assert.equal(r.changed, 1);
  assert.equal(await qty(rice), before - 3 - 1);
  assert.equal(Number(r.value_change), -3 * 7500);
  await assert.rejects(as(owner, 'select public.set_stock_count_line($1, $2, 1)', [c.id, rice]), /finished/);
  await assert.rejects(as(cashier, 'select public.start_stock_count($1)', [store]), /Permission denied/);
});

test('transfers: stock leaves on send, arrives on receive (matched or created by SKU)', async () => {
  const branches = (await as(owner, 'select * from public.list_transfer_branches($1)', [store])).rows;
  assert.deepEqual(branches.map((b) => b.id), [branch]);
  await assert.rejects(as(owner, 'select public.send_stock_transfer($1, $2, $3::jsonb)', [store, otherStore, JSON.stringify([{ productId: rice, quantity: 1 }])]), /another branch/);
  const start = await qty(rice);
  const t = (await as(owner, 'select * from public.send_stock_transfer($1, $2, $3::jsonb, $4)', [store, branch, JSON.stringify([{ productId: rice, quantity: 5 }]), 'Weekend stock'])).rows[0];
  assert.equal(await qty(rice), start - 5);
  assert.equal(t.status, 'in_transit');
  const detail = (await as(owner, 'select public.get_stock_transfer($1) j', [t.id])).rows[0].j;
  await as(owner, 'select public.receive_stock_transfer($1, $2::jsonb)', [t.id, JSON.stringify([{ lineId: detail.lines[0].id, quantityReceived: 4 }])]);
  const dest = await one("select id, stock_qty, cost_price from public.products where store_id=$1 and sku='RICE5'", [branch]);
  assert.equal(Number(dest.stock_qty), 4);
  assert.equal(Number(dest.cost_price), 7500);
  await assert.rejects(as(owner, 'select public.receive_stock_transfer($1)', [t.id]), /already received/);
  const list = (await as(owner, 'select * from public.list_stock_transfers($1)', [branch])).rows;
  assert.equal(list[0].direction, 'in'); assert.equal(Number(list[0].units_received), 4);
});

test('cancelling a transfer on the way puts the stock back', async () => {
  const start = await qty(milk);
  const t = (await as(owner, 'select * from public.send_stock_transfer($1, $2, $3::jsonb)', [store, branch, JSON.stringify([{ productId: milk, quantity: 2 }])])).rows[0];
  assert.equal(await qty(milk), start - 2);
  await assert.rejects(as(outsider, 'select public.cancel_stock_transfer($1)', [t.id]), /not found/);
  await as(owner, 'select public.cancel_stock_transfer($1)', [t.id]);
  assert.equal(await qty(milk), start);
});

test('low stock: at or below reorder level, most urgent first, with the last supplier', async () => {
  await pool.query('update public.products set stock_qty = 1, reorder_level = 10 where id = $1', [rice]);
  await pool.query('update public.products set stock_qty = 5, reorder_level = 6 where id = $1', [milk]);
  const rows = (await as(owner, 'select * from public.list_low_stock($1)', [store])).rows;
  assert.deepEqual(rows.map((r) => r.name), ['Rice 5kg', 'Peak Milk']);
  assert.equal(rows[0].supplier_name, 'Dangote Foods');
  assert.equal(Number(rows[0].suggested_qty), 19);
  await assert.rejects(as(outsider, 'select * from public.list_low_stock($1)', [store]), /Permission denied/);
});
