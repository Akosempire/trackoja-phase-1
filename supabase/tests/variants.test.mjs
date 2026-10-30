// Sizes and colours: selling a variant moves the right stock and charges the
// right price; voids and refunds give it back; barcodes and reminders.
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

let owner, outsider, store, shirt, plain;
const stock = async (table, id) => Number((await one(`select stock_qty from public.${table} where id=$1`, [id])).stock_qty);
const variant = async (size, colour) => (await one('select * from public.product_variants where product_id=$1 and size is not distinct from $2 and colour is not distinct from $3', [shirt, size, colour]));
const sell = (items, amount, extra = {}) => as(owner, 'select (public.create_sale($1, $2::jsonb, $3::jsonb, null, null, 0, null, $4)).id', [
  store, JSON.stringify(items), JSON.stringify([{ method: extra.credit ? 'credit' : 'cash', amount, verificationStatus: 'verified' }]), extra.customer ?? null,
]).then((r) => r.rows[0].id);

test.before(async () => {
  const s = Date.now();
  owner = (await one('insert into auth.users(email) values ($1) returning id', [`var-${s}@a.test`])).id;
  outsider = (await one('insert into auth.users(email) values ($1) returning id', [`var-x-${s}@a.test`])).id;
  store = (await as(owner, "select public.create_onboarding_business('Ada Fashion', 'Yaba branch', 'fashion_store') j")).rows[0].j.store_id;
  await as(outsider, "select public.create_onboarding_business('Other', 'Other branch', 'general_retail') j");
  await pool.query("update public.organizations set billing_status='active' where id=(select org_id from public.stores where id=$1)", [store]);
  shirt = (await one("insert into public.products(store_id,name,sku,selling_price,stock_qty,created_by) values ($1,'Ankara shirt','ANK-1',10000,0,$2) returning id", [store, owner])).id;
  plain = (await one("insert into public.products(store_id,name,sku,selling_price,stock_qty,created_by) values ($1,'Belt','BLT-1',3000,10,$2) returning id", [store, owner])).id;
});
test.after(() => pool.end());

test('saving variants sets each one and makes the product stock their total, through the ledger', async () => {
  await as(owner, 'select public.save_product_variants($1, $2::jsonb, $3::jsonb)', [shirt,
    JSON.stringify([{ name: 'Size', values: ['M', 'L'] }, { name: 'Colour', values: ['Red', 'Blue'] }]),
    JSON.stringify([
      { size: 'M', colour: 'Red', sku: 'ANK-M-RED', barcode: '8000001', stock: 5 },
      { size: 'L', colour: 'Red', sku: 'ANK-L-RED', stock: 3, price: 12000 },
      { size: 'M', colour: 'Blue', sku: 'ANK-M-BLU', stock: 2 },
    ])]);
  assert.equal(await stock('products', shirt), 10);
  const mv = await one("select quantity, movement_type from public.inventory_movements where product_id=$1 order by created_at desc limit 1", [shirt]);
  assert.equal(Number(mv.quantity), 10); assert.equal(mv.movement_type, 'adjustment');
  assert.deepEqual((await one('select variant_options from public.products where id=$1', [shirt])).variant_options.map((o) => o.name), ['Size', 'Colour']);
});

test('selling a variant charges its price, names the line and lowers both stocks', async () => {
  const lr = await variant('L', 'Red');
  const id = await sell([{ productId: shirt, variantId: lr.id, quantity: 2 }], 24000);
  const line = await one('select * from public.sale_items where sale_id=$1', [id]);
  assert.equal(line.product_name, 'Ankara shirt – L / Red');
  assert.equal(line.sku, 'ANK-L-RED');
  assert.equal(Number(line.unit_price), 12000);
  assert.equal(line.variant_id, lr.id);
  assert.equal(Number((await one('select total from public.sales where id=$1', [id])).total), 24000);
  assert.equal(await stock('product_variants', lr.id), 1);
  assert.equal(await stock('products', shirt), 8);
});

test('a variant without its own price uses the product price; plain products are unchanged', async () => {
  const mr = await variant('M', 'Red');
  const id = await sell([{ productId: shirt, variantId: mr.id, quantity: 1 }, { productId: plain, quantity: 2 }], 16000);
  const lines = (await pool.query('select product_name, unit_price, variant_id from public.sale_items where sale_id=$1 order by product_name', [id])).rows;
  assert.deepEqual(lines.map((l) => [l.product_name, Number(l.unit_price)]), [['Ankara shirt – M / Red', 10000], ['Belt', 3000]]);
  assert.equal(lines[1].variant_id, null);
  assert.equal(await stock('products', plain), 8);
});

test("you can't sell more of a variant than it has, or another product's variant", async () => {
  const mb = await variant('M', 'Blue');
  await assert.rejects(sell([{ productId: shirt, variantId: mb.id, quantity: 3 }], 30000), /Insufficient stock/);
  await assert.rejects(sell([{ productId: plain, variantId: mb.id, quantity: 1 }], 3000), /no longer available/);
});

test('voiding gives the variant its stock back; so does a refund', async () => {
  const mb = await variant('M', 'Blue');
  const id = await sell([{ productId: shirt, variantId: mb.id, quantity: 2 }], 20000);
  assert.equal(await stock('product_variants', mb.id), 0);
  await as(owner, "select public.void_sale($1, 'wrong size')", [id]);
  assert.equal(await stock('product_variants', mb.id), 2);
  const id2 = await sell([{ productId: shirt, variantId: mb.id, quantity: 2 }], 20000);
  const item = await one('select id from public.sale_items where sale_id=$1', [id2]);
  await as(owner, "select public.process_refund($1, 10000, 'returned one', 'cash', $2::jsonb)", [id2, JSON.stringify([{ saleItemId: item.id, quantity: 1 }])]);
  assert.equal(await stock('product_variants', mb.id), 1);
  const total = Number((await one("select coalesce(sum(stock_qty),0) s from public.product_variants where product_id=$1 and status='active'", [shirt])).s);
  assert.equal(await stock('products', shirt), total);
});

test('removing a variant archives it; outsiders cannot edit', async () => {
  await assert.rejects(as(outsider, "select public.save_product_variants($1, '[]'::jsonb, '[]'::jsonb)", [shirt]), /Permission denied/);
  const mr = await variant('M', 'Red');
  await as(owner, 'select public.save_product_variants($1, $2::jsonb, $3::jsonb)', [shirt, JSON.stringify([{ name: 'Size', values: ['M'] }, { name: 'Colour', values: ['Red'] }]),
    JSON.stringify([{ size: 'M', colour: 'Red', sku: 'ANK-M-RED', barcode: '8000001', stock: mr.stock_qty }])]);
  assert.equal((await variant('L', 'Red')).status, 'archived');
  assert.equal(await stock('products', shirt), Number(mr.stock_qty));
});

test('labels: products without a barcode get one from the SKU, kept after', async () => {
  const r = (await as(owner, 'select * from public.ensure_product_barcodes($1::uuid[])', [[plain]])).rows[0];
  assert.equal(r.barcode, 'BLT-1');
  assert.equal((await one('select barcode from public.products where id=$1', [plain])).barcode, 'BLT-1');
});

test('credit reminders are logged; only for your own store', async () => {
  const c = (await one("insert into public.customers(store_id,name,phone,balance,credit_limit,created_by) values ($1,'Mama Nkechi','08035550000',15000,50000,$2) returning id", [store, owner])).id;
  await as(owner, 'select public.log_credit_reminder($1)', [c]);
  const log = await one("select details from public.audit_logs where action='CREDIT_REMINDER_SENT' and resource_id=$1", [c]);
  assert.equal(Number(log.details.balance), 15000);
  await assert.rejects(as(outsider, 'select public.log_credit_reminder($1)', [c]), /not found/);
});
