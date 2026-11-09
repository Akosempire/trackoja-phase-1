// Cartons and pieces: stock in bulk, sell by the carton or the piece, one balance.
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

let owner, store, indomie, loose;
const stock = async (id) => Number((await one('select stock_qty from public.products where id=$1', [id])).stock_qty);
const sell = (items, amount) => as(owner, 'select (public.create_sale($1, $2::jsonb, $3::jsonb, null, null, 0, null, null)).id', [
  store, JSON.stringify(items), JSON.stringify([{ method: 'cash', amount, verificationStatus: 'verified' }]),
]).then((r) => r.rows[0].id);
const receive = (productId, pieces) => as(owner, "select public.apply_inventory_movement($1, $2, 'replenishment', $3, 'Delivery', null, null)", [store, productId, pieces]);

test.before(async () => {
  const s = Date.now();
  owner = (await one('insert into auth.users(email) values ($1) returning id', [`pack-${s}@a.test`])).id;
  store = (await as(owner, "select public.create_onboarding_business('Mama Put Supplies', 'Oshodi', 'general_retail') j")).rows[0].j.store_id;
  await pool.query('update public.store_settings set require_open_till = false where store_id = $1', [store]);
  await pool.query("update public.organizations set billing_status='active' where id=(select org_id from public.stores where id=$1)", [store]);
  // a piece sells at N250; a carton of 24 sells wholesale at N5,400 (N225 a piece)
  indomie = (await one("insert into public.products(store_id,name,sku,unit,selling_price,stock_qty,pack_name,pack_size,pack_price,created_by) values ($1,'Indomie 70g','IND-70','piece',250,0,'Carton',24,5400,$2) returning id", [store, owner])).id;
  loose = (await one("insert into public.products(store_id,name,sku,selling_price,stock_qty,created_by) values ($1,'Sugar cube','SUG-1',100,50,$2) returning id", [store, owner])).id;
});
test.after(() => pool.end());

test('3 cartons in, 2 cartons to a wholesaler, 5 pieces to a shopper: 19 pieces left, one stock', async () => {
  await receive(indomie, 3 * 24);
  assert.equal(await stock(indomie), 72);

  const wholesale = await sell([{ productId: indomie, quantity: 2, unit: 'pack' }], 10800);
  const w = await one('select * from public.sale_items where sale_id=$1', [wholesale]);
  assert.equal(Number(w.quantity), 48, 'the line takes 48 pieces');
  assert.equal(Number(w.pack_qty), 2);
  assert.equal(w.pack_name, 'Carton');
  assert.equal(Number(w.pack_size), 24);
  assert.equal(Number(w.pack_price), 5400);
  assert.equal(Number(w.line_total), 10800, 'charged the carton price');
  assert.equal(await stock(indomie), 24);

  const retail = await sell([{ productId: indomie, quantity: 5 }], 1250);
  const r = await one('select * from public.sale_items where sale_id=$1', [retail]);
  assert.equal(Number(r.quantity), 5); assert.equal(r.pack_qty, null); assert.equal(Number(r.line_total), 1250);
  assert.equal(await stock(indomie), 19);
});

test('one sale can mix a carton and loose pieces of the same product', async () => {
  await receive(indomie, 21); // 40 pieces
  const id = await sell([{ productId: indomie, quantity: 1, unit: 'pack' }, { productId: indomie, quantity: 3 }], 5400 + 750);
  assert.equal(Number((await one('select total from public.sales where id=$1', [id])).total), 6150);
  assert.equal(await stock(indomie), 13);
});

test("can't sell more cartons than the pieces allow", async () => {
  const before = await stock(indomie);
  await assert.rejects(sell([{ productId: indomie, quantity: 99, unit: 'pack' }], 99 * 5400), /stock/i);
  assert.equal(await stock(indomie), before);
});

test('a carton price left empty is the pack size times the piece price', async () => {
  await pool.query('update public.products set pack_price = null, stock_qty = 100 where id = $1', [indomie]);
  const id = await sell([{ productId: indomie, quantity: 1, unit: 'pack' }], 6000);
  assert.equal(Number((await one('select line_total from public.sale_items where sale_id=$1', [id])).line_total), 24 * 250);
  assert.equal(await stock(indomie), 76);
});

test('a product without a pack can only be sold by the piece', async () => {
  await assert.rejects(sell([{ productId: loose, quantity: 1, unit: 'pack' }], 100), /isn't sold by the pack/);
});

test('voiding a carton sale puts all its pieces back', async () => {
  await pool.query('update public.products set pack_price = 5400 where id = $1', [indomie]);
  const before = await stock(indomie);
  const id = await sell([{ productId: indomie, quantity: 2, unit: 'pack' }], 10800);
  assert.equal(await stock(indomie), before - 48);
  await as(owner, "select public.void_sale($1, 'Wrong customer')", [id]);
  assert.equal(await stock(indomie), before);
});

test('Usetally gets a carton line as cartons at the carton price', async () => {
  const id = await sell([{ productId: indomie, quantity: 2, unit: 'pack' }], 10800);
  const p = (await one('select public.usetally_sale_payload($1) p', [id])).p;
  assert.equal(p.items[0].name, 'Indomie 70g (Carton of 24)');
  assert.equal(Number(p.items[0].quantity), 2);
  assert.equal(p.items[0].unit_price_minor, 540000);
  assert.equal(p.items[0].line_total_minor, 1080000);
});

test('pack settings are checked', async () => {
  await assert.rejects(pool.query('update public.products set pack_size = 1 where id = $1', [indomie]), /products_pack_ok/);
  await assert.rejects(pool.query('update public.products set pack_price = -1 where id = $1', [indomie]), /products_pack_ok/);
});
