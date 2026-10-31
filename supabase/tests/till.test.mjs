// Till sessions, cash movements, cashier PINs and manager-PIN approvals, on a
// throwaway local database (TK_DB=tk_till bash scripts/test-db.sh).
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

let owner, cashier, outsider, store, milk, session;
const sell = (who, items, payments) => as(who, 'select (public.create_sale($1, $2::jsonb, $3::jsonb)).id', [store, JSON.stringify(items), JSON.stringify(payments)]).then((r) => r.rows[0].id);
const cash = (amount) => [{ method: 'cash', amount, verificationStatus: 'verified' }];

test.before(async () => {
  const s = Date.now();
  const mk = async (tag) => (await one('insert into auth.users(email) values ($1) returning id', [`till-${tag}-${s}@a.test`])).id;
  owner = await mk('owner'); cashier = await mk('cashier'); outsider = await mk('out');
  for (const [id, first] of [[owner, 'Ada'], [cashier, 'Bayo'], [outsider, 'Chi']]) {
    await pool.query("update public.users set first_name = $2 where id = $1", [id, first]).catch(() => {});
  }
  store = (await as(owner, "select public.create_onboarding_business('Till Shop', 'Ikeja branch', 'general_retail') j")).rows[0].j.store_id;
  await pool.query("update public.organizations set billing_status = 'active' where id = (select org_id from public.stores where id = $1)", [store]);
  await pool.query("update public.organization_products set status = 'active', expires_at = null, agreed_user_limit = -1 where org_id = (select org_id from public.stores where id = $1)", [store]);
  const role = (await one("select id from public.roles where name = 'cashier' and is_system order by created_at limit 1")).id;
  await pool.query("insert into public.store_members(store_id, user_id, role_id, status, accepted_at) values ($1, $2, $3, 'active', now())", [store, cashier, role]);
  milk = (await one('insert into public.products(store_id, name, sku, selling_price, stock_qty, created_by) values ($1, $2, $3, $4, $5, $6) returning id',
    [store, 'Peak Milk', 'FD-1', 3200, 1000, owner])).id;
});
test.after(() => pool.end());

test('new stores require an open till; with it switched off, selling without one works', async () => {
  assert.equal((await one('select require_open_till from public.store_settings where store_id = $1', [store])).require_open_till, true);
  await assert.rejects(sell(owner, [{ productId: milk, quantity: 1 }], cash(3200)), /Open the till/);
  await as(owner, 'select public.till_set_required($1, false)', [store]);
  const id = await sell(owner, [{ productId: milk, quantity: 1 }], cash(3200));
  const s = await one('select till_session_id, cashier_id from public.sales where id = $1', [id]);
  assert.equal(s.till_session_id, null);
  assert.equal(s.cashier_id, owner);
});

test('a store can require an open till; only managers can switch it', async () => {
  await assert.rejects(as(cashier, 'select public.till_set_required($1, true)', [store]), /manager/);
  await as(owner, 'select public.till_set_required($1, true)', [store]);
  await assert.rejects(sell(cashier, [{ productId: milk, quantity: 1 }], cash(3200)), /Open the till/);
});

test('open, sell, cash movements and refunds give the expected cash', async () => {
  const opened = (await as(cashier, 'select public.till_open($1, 5000) j', [store])).rows[0].j;
  session = opened.session_id;
  assert.equal(Number(opened.opening_float), 5000);
  await assert.rejects(as(cashier, 'select public.till_open($1, 0)', [store]), /already open/);
  // 2 × 3200 = 6400, paid 10000 cash → change 3600
  const a = await sell(cashier, [{ productId: milk, quantity: 2 }], cash(10000));
  // 3200 by card: not cash
  await sell(cashier, [{ productId: milk, quantity: 1 }], [{ method: 'card', amount: 3200, verificationStatus: 'verified' }]);
  await as(cashier, "select public.till_cash_move($1, 'out', 1500, 'Paid the delivery man')", [session]);
  await as(cashier, "select public.till_cash_move($1, 'in', 500, 'Float top-up')", [session]);
  // cash refund of 1000 by the owner (owner has no open till → the store's only open session)
  await as(owner, "select public.process_refund($1, 1000, 'Damaged tin', 'cash')", [a]);
  const n = (await as(cashier, 'select public.till_current($1) j', [store])).rows[0].j;
  assert.equal(n.sales_count, 2);
  assert.equal(Number(n.sales_total), 9600);
  assert.equal(Number(n.by_method.card), 3200);
  assert.equal(Number(n.refunds_cash), 1000);
  // 5000 + 10000 − 3600 + 500 − 1500 − 1000
  assert.equal(Number(n.expected_cash), 9400);
});

test('voided sales leave the cash count; closing stores the Z report', async () => {
  const v = await sell(cashier, [{ productId: milk, quantity: 1 }], cash(3200));
  await as(owner, "select public.void_sale($1, 'rang twice')", [v]);
  await assert.rejects(as(outsider, 'select public.till_close($1, 0)', [session]), /not found/);
  const z = (await as(cashier, "select public.till_close($1, 9300, 'Short 100, gave change wrong') j", [session])).rows[0].j;
  assert.equal(z.status, 'closed');
  assert.equal(Number(z.expected_cash), 9400);
  assert.equal(Number(z.counted_cash), 9300);
  assert.equal(Number(z.difference), -100);
  assert.equal(z.voids_count, 1);
  assert.equal(z.movements.length, 2);
  await assert.rejects(as(cashier, "select public.till_cash_move($1, 'in', 10, 'late')", [session]), /closed/);
  const again = (await as(owner, 'select public.till_report($1) j', [session])).rows[0].j;
  assert.equal(Number(again.difference), -100);
  const hist = (await as(owner, 'select public.till_history($1) j', [store])).rows[0].j;
  assert.equal(hist[0].id, session);
  assert.equal((await as(outsider, 'select public.till_history($1) j', [store])).rows[0].j.length, 0);
});

test('PINs: only managers set them, nobody can read them, and they identify the cashier', async () => {
  await assert.rejects(as(cashier, "select public.set_staff_pin($1, $2, '4829')", [store, cashier]), /owner or manager/);
  await assert.rejects(as(owner, "select public.set_staff_pin($1, $2, '1234')", [store, cashier]), /less obvious/);
  await assert.rejects(as(owner, "select public.set_staff_pin($1, $2, '12a4')", [store, cashier]), /4 to 6 digits/);
  await as(owner, "select public.set_staff_pin($1, $2, '4829')", [store, cashier]);
  await as(owner, "select public.set_staff_pin($1, $2, '7391')", [store, owner]);
  await assert.rejects(as(owner, "select public.set_staff_pin($1, $2, '7391')", [store, cashier]), /already uses/);
  await assert.rejects(as(owner, 'select pin_hash from public.staff_pins'));
  const status = (await as(owner, 'select public.staff_pin_status($1) j', [store])).rows[0].j;
  assert.equal(status.length, 2);
  // the owner's account on a shared phone: Bayo identifies, and the sale is his
  await as(owner, 'select public.till_set_required($1, false)', [store]);
  const who = (await as(owner, "select public.identify_cashier($1, '4829') j", [store])).rows[0].j;
  assert.equal(who.ok, true); assert.equal(who.user_id, cashier);
  const id = await sell(owner, [{ productId: milk, quantity: 1 }], cash(3200));
  assert.equal((await one('select cashier_id from public.sales where id = $1', [id])).cashier_id, cashier);
  // Bayo is a cashier: going back to the owner's account needs a manager PIN
  await assert.rejects(as(owner, 'select public.clear_cashier($1)', [store]), /manager or the owner/);
  const ok = (await as(owner, "select public.request_manager_override($1, 'exit_register', '7391') j", [store])).rows[0].j;
  await as(owner, 'select public.clear_cashier($1, $2)', [store, ok.approval_id]);
  assert.equal((await as(owner, 'select public.current_cashier($1) j', [store])).rows[0].j, null);
});

test('5 wrong PINs lock PIN entry for that account', async () => {
  for (let i = 0; i < 4; i++) {
    const r = (await as(cashier, "select public.identify_cashier($1, '9999') j", [store])).rows[0].j;
    assert.equal(r.ok, false);
  }
  const fifth = (await as(cashier, "select public.identify_cashier($1, '9999') j", [store])).rows[0].j;
  assert.match(fifth.error, /locked/);
  await assert.rejects(as(cashier, "select public.identify_cashier($1, '4829') j", [store]), /Too many wrong PINs/);
  await pool.query('delete from public.pin_attempts');
});

test("a manager's PIN approves a void the cashier can't do, as that manager", async () => {
  const id = await sell(cashier, [{ productId: milk, quantity: 1 }], cash(3200));
  await assert.rejects(as(cashier, "select public.void_sale($1, 'x')", [id]));
  const bad = (await as(cashier, "select public.void_sale_with_pin($1, 'wrong item', '4829') j", [id]).catch((e) => ({ rows: [{ j: { error: e.message } }] }))).rows[0].j;
  assert.match(bad.error, /cannot approve/);
  const ok = (await as(cashier, "select public.void_sale_with_pin($1, 'wrong item', '7391') j", [id])).rows[0].j;
  assert.equal(ok.ok, true);
  const s = await one('select status, voided_by from public.sales where id = $1', [id]);
  assert.equal(s.status, 'voided'); assert.equal(s.voided_by, owner);
  const r = (await as(cashier, "select public.process_refund_with_pin($1, 100, 'goodwill', 'cash', null, '0000') j", [await sell(cashier, [{ productId: milk, quantity: 1 }], cash(3200))])).rows[0].j;
  assert.equal(r.ok, false);
});
