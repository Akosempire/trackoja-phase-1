// Wholesalers buy any quantity at wholesale prices; a cashier can't hand out
// wholesale prices to anyone else without a manager's approval.
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
const roleId = async (name) => (await one('select id from public.roles where name = $1 and is_system order by created_at limit 1', [name])).id;

let owner, manager, cashier, store, indomie, sugar, chidi, walkIn;
const sell = (who, items, amount, customer = null) => as(who, 'select (public.create_sale($1, $2::jsonb, $3::jsonb, null, null, 0, null, $4)).id', [
  store, JSON.stringify(items), JSON.stringify([{ method: 'cash', amount, verificationStatus: 'verified' }]), customer,
]).then((r) => r.rows[0].id);

test.before(async () => {
  const s = Date.now();
  const mk = async (tag) => (await one('insert into auth.users(email) values ($1) returning id', [`ws-${tag}-${s}@a.test`])).id;
  owner = await mk('owner'); manager = await mk('manager'); cashier = await mk('cashier');
  store = (await as(owner, "select public.create_onboarding_business('Oja Wholesale', 'Idumota', 'general_retail') j")).rows[0].j.store_id;
  const org = (await one('select org_id from public.stores where id = $1', [store])).org_id;
  await pool.query("update public.organizations set billing_status = 'active' where id = $1", [org]);
  await pool.query("update public.organization_products set status = 'active', expires_at = null, agreed_user_limit = -1 where org_id = $1", [org]);
  await pool.query('update public.store_settings set require_open_till = false where store_id = $1', [store]);
  for (const [u, r] of [[manager, 'manager'], [cashier, 'cashier']]) {
    await pool.query("insert into public.store_members(store_id, user_id, role_id, status, accepted_at) values ($1, $2, $3, 'active', now())", [store, u, await roleId(r)]);
  }
  await as(owner, "select public.set_staff_pin($1, $2, '5502')", [store, manager]);
  indomie = (await one("insert into public.products(store_id,name,sku,unit,selling_price,stock_qty,pack_name,pack_size,pack_price,created_by) values ($1,'Indomie 70g','IND-70','pcs',250,500,'Carton',24,5400,$2) returning id", [store, owner])).id;
  sugar = (await one("insert into public.products(store_id,name,sku,selling_price,wholesale_price,stock_qty,created_by) values ($1,'St Louis sugar','SUG',1200,1050,200,$2) returning id", [store, owner])).id;
  chidi = (await one("insert into public.customers(store_id,name,phone,created_by) values ($1,'Chidi Stores','08030000000',$2) returning id", [store, owner])).id;
  walkIn = (await one("insert into public.customers(store_id,name,created_by) values ($1,'Random buyer',$2) returning id", [store, owner])).id;
});
test.after(() => pool.end());

test('the app can read the new product and customer columns (cost stays private)', async () => {
  const p = (await as(cashier, 'select pack_name, pack_size, pack_price, wholesale_price from public.products where id = $1', [indomie])).rows[0];
  assert.equal(p.pack_name, 'Carton');
  await assert.rejects(as(cashier, 'select cost_price from public.products where id = $1', [indomie]), /permission denied/);
  assert.equal((await as(cashier, 'select is_wholesaler from public.customers where id = $1', [chidi])).rows[0].is_wholesaler, false);
});

test('only an owner or manager marks a customer as a wholesaler', async () => {
  // refused, or quietly not allowed to edit the customer at all: either way it stays off
  await as(cashier, 'update public.customers set is_wholesaler = true where id = $1', [chidi]).catch((e) => assert.match(e.message, /owner or manager|permission/));
  assert.equal((await one('select is_wholesaler from public.customers where id = $1', [chidi])).is_wholesaler, false);
  await assert.rejects(as(cashier, "insert into public.customers(store_id, name, is_wholesaler, created_by) values ($1, 'Fake wholesaler', true, $2)", [store, cashier]), /owner or manager|row-level security|permission/);
  await as(manager, 'update public.customers set is_wholesaler = true where id = $1', [chidi]);
  assert.equal((await one('select is_wholesaler from public.customers where id = $1', [chidi])).is_wholesaler, true);
});

test('a wholesaler buys any odd quantities of different products at wholesale, from a cashier', async () => {
  const id = await sell(cashier, [
    { productId: indomie, quantity: 7, price: 'wholesale' }, // 7 x N225
    { productId: sugar, quantity: 3, price: 'wholesale' },   // 3 x N1,050
  ], 7 * 225 + 3 * 1050, chidi);
  assert.equal(Number((await one('select total from public.sales where id = $1', [id])).total), 1575 + 3150);
  assert.equal(Number((await one('select stock_qty from public.products where id = $1', [indomie])).stock_qty), 493);
});

test("a cashier can't give wholesale prices to anyone else", async () => {
  await assert.rejects(sell(cashier, [{ productId: sugar, quantity: 6, price: 'wholesale' }], 6300, walkIn), /wholesale customer or a manager/);
  await assert.rejects(sell(cashier, [{ productId: sugar, quantity: 6, price: 'wholesale' }], 6300), /wholesale customer or a manager/);
  // retail is fine, and a carton is a carton for anyone
  assert.ok(await sell(cashier, [{ productId: sugar, quantity: 6 }, { productId: indomie, quantity: 1, unit: 'pack' }], 7200 + 5400, walkIn));
});

test("with a manager's PIN, one walk-in sale gets wholesale prices, and the sale names the manager", async () => {
  const ok = (await as(cashier, "select public.request_manager_override($1, 'wholesale', '5502') j", [store])).rows[0].j;
  assert.equal(ok.ok, true);
  const id = await sell(cashier, [{ productId: sugar, quantity: 10, price: 'wholesale' }], 10500, walkIn);
  assert.equal((await one('select approved_by from public.sales where id = $1', [id])).approved_by, manager);
  // used up: the next one needs another approval
  await assert.rejects(sell(cashier, [{ productId: sugar, quantity: 2, price: 'wholesale' }], 2100, walkIn), /wholesale customer or a manager/);
});

test("managers and owners don't need a PIN", async () => {
  assert.ok(await sell(manager, [{ productId: sugar, quantity: 4, price: 'wholesale' }], 4200));
  assert.ok(await sell(owner, [{ productId: indomie, quantity: 6, price: 'wholesale' }], 1350, walkIn));
});
