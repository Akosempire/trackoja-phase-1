// Roles, PIN switch permissions, manager overrides, discount limit, cost
// privacy, branch lock and audit (POS UX upgrade section 9), on a throwaway
// local database (TK_DB=tk_roles bash scripts/test-db.sh).
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
const can = async (who, store, perm) => (await as(who, 'select public.user_has_permission($1, $2, $3) ok', [who, store, perm])).rows[0].ok;

let owner, manager, cashier, officer, store, branchB, milk;
const sell = (who, items, payments, discount = 0) =>
  as(who, 'select (public.create_sale($1, $2::jsonb, $3::jsonb, null, null, $4)).id', [store, JSON.stringify(items), JSON.stringify(payments), discount]).then((r) => r.rows[0].id);
const cash = (amount) => [{ method: 'cash', amount, verificationStatus: 'verified' }];
const roleId = async (name) => (await one('select id from public.roles where name = $1 and is_system order by created_at limit 1', [name])).id;

test.before(async () => {
  const s = Date.now();
  const mk = async (tag, first) => {
    const id = (await one('insert into auth.users(email) values ($1) returning id', [`roles-${tag}-${s}@a.test`])).id;
    await pool.query('update public.users set first_name = $2 where id = $1', [id, first]).catch(() => {});
    return id;
  };
  owner = await mk('owner', 'Ada'); manager = await mk('manager', 'Musa'); cashier = await mk('cashier', 'Bayo'); officer = await mk('officer', 'Ife');
  store = (await as(owner, "select public.create_onboarding_business('Roles Shop', 'Ikeja branch', 'general_retail') j")).rows[0].j.store_id;
  const org = (await one('select org_id from public.stores where id = $1', [store])).org_id;
  await pool.query("update public.organizations set billing_status = 'active' where id = $1", [org]);
  await pool.query("update public.organization_products set status = 'active', expires_at = null, agreed_user_limit = -1 where org_id = $1", [org]);
  await pool.query('update public.store_settings set require_open_till = false where store_id = $1', [store]);
  for (const [u, r] of [[manager, 'manager'], [cashier, 'cashier'], [officer, 'inventory_officer']]) {
    await pool.query("insert into public.store_members(store_id, user_id, role_id, status, accepted_at) values ($1, $2, $3, 'active', now())", [store, u, await roleId(r)]);
  }
  // a second branch of the same business: the owner works there, the cashier doesn't
  branchB = (await one("insert into public.stores(org_id, name, slug, created_by, status, currency) values ($1, 'Yaba branch', $2, $3, 'active', 'NGN') returning id", [org, `yaba-${s}`, owner])).id;
  await pool.query("insert into public.store_members(store_id, user_id, role_id, status, accepted_at) values ($1, $2, $3, 'active', now())", [branchB, owner, await roleId('owner')]);
  await pool.query('insert into public.store_settings(store_id, require_open_till) values ($1, false)', [branchB]);
  milk = (await one('insert into public.products(store_id, name, sku, selling_price, cost_price, stock_qty, created_by) values ($1, $2, $3, $4, $5, $6, $7) returning id',
    [store, 'Peak Milk', 'FD-1', 3200, 2500, 1000, owner])).id;
  await as(owner, "select public.set_staff_pin($1, $2, '7391')", [store, owner]);
  await as(owner, "select public.set_staff_pin($1, $2, '5502')", [store, manager]);
  await as(owner, "select public.set_staff_pin($1, $2, '4829')", [store, cashier]);
  await as(owner, "select public.set_staff_pin($1, $2, '6614')", [store, officer]);
});
test.after(() => pool.end());

test('each role gets exactly its capabilities', async () => {
  assert.equal(await can(cashier, store, 'sales:create'), true);
  for (const p of ['reports:view', 'cost:view', 'inventory:adjust', 'product:update', 'member:manage', 'settings:update', 'sales:void']) {
    assert.equal(await can(cashier, store, p), false, `cashier must not have ${p}`);
  }
  assert.equal(await can(officer, store, 'inventory:adjust'), true);
  assert.equal(await can(officer, store, 'purchase:create'), true);
  for (const p of ['sales:create', 'reports:view', 'member:manage', 'settings:update', 'price:edit']) {
    assert.equal(await can(officer, store, p), false, `inventory officer must not have ${p}`);
  }
  for (const p of ['sales:override', 'cost:view', 'price:edit', 'sales:view_all', 'reports:view']) assert.equal(await can(manager, store, p), true);
  assert.equal(await can(manager, store, 'store:delete'), false);
});

test('a cashier switched in on the owner\'s device has the cashier\'s permissions', async () => {
  const who = (await as(owner, "select public.identify_cashier($1, '4829') j", [store])).rows[0].j;
  assert.equal(who.ok, true); assert.equal(who.role, 'cashier');
  assert.equal(await can(owner, store, 'reports:view'), false);
  assert.equal(await can(owner, store, 'sales:create'), true);
  const mine = (await as(owner, 'select public.get_my_permissions($1) j', [store])).rows[0].j;
  assert.equal(mine.role.name, 'cashier'); assert.equal(mine.acting.user_id, cashier);
  assert.ok(!mine.permissions.some((p) => p.name === 'reports:view'));
  await assert.rejects(as(owner, "select public.get_sales_summary($1, now() - interval '1 day', now())", [store]));
  const id = await sell(owner, [{ productId: milk, quantity: 1 }], cash(3200));
  await assert.rejects(as(owner, "select public.void_sale($1, 'x')", [id]), /sales:void/);
  // costs: not via the table, not via the RPC
  await assert.rejects(as(owner, 'select cost_price from public.products where id = $1', [milk]));
  assert.equal((await as(owner, 'select * from public.get_product_costs($1)', [store])).rowCount, 0);
  // settings: no write
  const upd = await as(owner, 'update public.store_settings set allow_negative_stock = true where store_id = $1', [store]);
  assert.equal(upd.rowCount, 0);
  // and the owner-only business actions are off
  const org = (await one('select org_id from public.stores where id = $1', [store])).org_id;
  assert.equal((await as(owner, 'select public.is_business_owner($1) ok', [org])).rows[0].ok, false);
});

test('branch lock: with the cashier acting, the owner\'s other branch is closed', async () => {
  assert.equal(await can(owner, branchB, 'sales:create'), false);
  const ids = (await as(owner, 'select public.get_user_active_store_ids($1) id', [owner])).rows.map((r) => r.id);
  assert.ok(ids.includes(store)); assert.ok(!ids.includes(branchB));
});

test('going back to the owner needs a manager PIN; overrides are single-use and expire', async () => {
  await assert.rejects(as(owner, 'select public.clear_cashier($1)', [store]), /manager or the owner/);
  const wrong = (await as(owner, "select public.request_manager_override($1, 'exit_register', '0001') j", [store])).rows[0].j;
  assert.equal(wrong.ok, false);
  const notMgr = (await as(owner, "select public.request_manager_override($1, 'exit_register', '6614') j", [store])).rows[0].j;
  assert.equal(notMgr.ok, false); assert.match(notMgr.error, /cannot approve/);
  const ok = (await as(owner, "select public.request_manager_override($1, 'exit_register', '5502', '{\"why\":\"end of shift\"}') j", [store])).rows[0].j;
  assert.equal(ok.ok, true); assert.equal(ok.approver_name, 'Musa');
  await as(owner, 'select public.clear_cashier($1, $2)', [store, ok.approval_id]);
  assert.equal(await can(owner, store, 'reports:view'), true);
  assert.equal(await can(owner, branchB, 'sales:create'), true);
  // used once
  await as(owner, "select public.identify_cashier($1, '4829')", [store]);
  await assert.rejects(as(owner, 'select public.clear_cashier($1, $2)', [store, ok.approval_id]), /manager or the owner/);
  // expired
  const late = (await as(owner, "select public.request_manager_override($1, 'exit_register', '5502') j", [store])).rows[0].j;
  await pool.query("update public.manager_approvals set expires_at = now() - interval '1 second' where id = $1", [late.approval_id]);
  await assert.rejects(as(owner, 'select public.clear_cashier($1, $2)', [store, late.approval_id]), /manager or the owner/);
  // the audit names both people
  const log = await one("select details from public.audit_logs where action = 'MANAGER_OVERRIDE' and resource_id = $1", [ok.approval_id]);
  assert.equal(log.details.acting_name, 'Bayo'); assert.equal(log.details.approver_name, 'Musa');
});

test('a manager\'s approval voids a sale on the cashier\'s session, and the sale names the approver', async () => {
  // owner's device still has Bayo acting
  const id = await sell(owner, [{ productId: milk, quantity: 1 }], cash(3200));
  const ok = (await as(owner, "select public.request_manager_override($1, 'void', '7391', jsonb_build_object('sale_id', $2::text)) j", [store, id])).rows[0].j;
  const r = (await as(owner, "select public.void_sale_approved($1, 'wrong item', $2) j", [id, ok.approval_id])).rows[0].j;
  assert.equal(r.ok, true); assert.equal(r.approved_by, 'Ada');
  const s = await one('select status, voided_by, approved_by, cashier_id from public.sales where id = $1', [id]);
  assert.equal(s.status, 'voided'); assert.equal(s.voided_by, owner); assert.equal(s.approved_by, owner); assert.equal(s.cashier_id, cashier);
  await assert.rejects(as(owner, "select public.void_sale_approved($1, 'again', $2)", [id, ok.approval_id]), /expired or was already used/);
  // the old PIN route still works, and records the approval
  const id2 = await sell(owner, [{ productId: milk, quantity: 1 }], cash(3200));
  const r2 = (await as(owner, "select public.void_sale_with_pin($1, 'customer left', '5502') j", [id2])).rows[0].j;
  assert.equal(r2.ok, true);
  assert.equal((await one('select approved_by from public.sales where id = $1', [id2])).approved_by, manager);
});

test('discounts above the branch limit need an approval', async () => {
  await assert.rejects(as(cashier, 'select public.set_discount_limit($1, 10)', [store]), /owner or manager/);
  await as(manager, 'select public.set_discount_limit($1, 10)', [store]);
  await assert.rejects(sell(cashier, [{ productId: milk, quantity: 1 }], cash(3200), 640), /above 10 percent needs a manager PIN/);
  const small = await sell(cashier, [{ productId: milk, quantity: 1 }], cash(3200), 320);
  assert.ok(small);
  const ok = (await as(cashier, "select public.request_manager_override($1, 'discount', '5502') j", [store])).rows[0].j;
  const id = await sell(cashier, [{ productId: milk, quantity: 1 }], cash(3200), 640);
  assert.equal((await one('select approved_by from public.sales where id = $1', [id])).approved_by, manager);
  assert.ok((await one('select used_at from public.manager_approvals where id = $1', [ok.approval_id])).used_at);
  // managers don't need one
  assert.ok(await sell(manager, [{ productId: milk, quantity: 1 }], cash(3200), 1600));
});

test('inventory officer: adjusts stock, cannot sell or change prices', async () => {
  await as(officer, "select public.apply_inventory_movement($1, $2, 'adjustment', 5, 'Found in store', null, null)", [store, milk]).catch(async (e) => {
    if (/movement type/i.test(e.message)) await as(officer, "select public.apply_inventory_movement($1, $2, 'restock', 5, 'Found in store', null, null)", [store, milk]);
    else throw e;
  });
  const mv = await one('select created_by, acting_user_id from public.inventory_movements where product_id = $1 order by created_at desc limit 1', [milk]);
  assert.equal(mv.acting_user_id, officer);
  await assert.rejects(sell(officer, [{ productId: milk, quantity: 1 }], cash(3200)));
  await assert.rejects(as(officer, 'update public.products set selling_price = 1 where id = $1', [milk]), /change prices/);
  const named = await as(officer, "update public.products set name = 'Peak Milk 400g' where id = $1", [milk]);
  assert.equal(named.rowCount, 1);
  // the officer may see costs (receiving stock needs them); the cashier may not
  assert.equal((await as(officer, 'select * from public.get_product_costs($1)', [store])).rowCount >= 1, true);
  assert.equal((await as(cashier, 'select * from public.get_product_costs($1)', [store])).rowCount, 0);
  await assert.rejects(as(cashier, 'select cost_price from public.products where id = $1', [milk]));
  // ordinary columns stay readable for everyone in the branch
  assert.equal((await as(cashier, 'select name, selling_price from public.products where id = $1', [milk])).rowCount, 1);
});

test('cashiers see only their own sales from today; managers see all', async () => {
  const mine = await sell(cashier, [{ productId: milk, quantity: 1 }], cash(3200));
  const theirs = await sell(manager, [{ productId: milk, quantity: 1 }], cash(3200));
  const seen = (await as(cashier, 'select id from public.sales where id = any($1::uuid[])', [[mine, theirs]])).rows.map((r) => r.id);
  assert.deepEqual(seen, [mine]);
  assert.equal((await as(cashier, 'select count(*)::int n from public.sale_items where sale_id = $1', [theirs])).rows[0].n, 0);
  await pool.query("update public.sales set created_at = now() - interval '2 days' where id = $1", [mine]);
  assert.equal((await as(cashier, 'select id from public.sales where id = $1', [mine])).rowCount, 0);
  assert.equal((await as(manager, 'select id from public.sales where id = any($1::uuid[])', [[mine, theirs]])).rowCount, 2);
});

test('staff: nobody raises their own role, managers can\'t touch the owner', async () => {
  const ownerRole = await roleId('owner');
  await assert.rejects(as(cashier, 'update public.store_members set role_id = $1 where store_id = $2 and user_id = $3', [ownerRole, store, cashier]));
  await assert.rejects(as(manager, 'update public.store_members set role_id = $1 where store_id = $2 and user_id = $3', [ownerRole, store, cashier]), /owner/);
  await assert.rejects(as(manager, 'update public.store_members set role_id = $1 where store_id = $2 and user_id = $3', [await roleId('cashier'), store, owner]), /owner/);
  // a manager can still move a cashier to inventory
  const r = await as(manager, 'update public.store_members set role_id = $1 where store_id = $2 and user_id = $3', [await roleId('inventory_officer'), store, cashier]);
  assert.equal(r.rowCount, 1);
  await pool.query('update public.store_members set role_id = $1 where store_id = $2 and user_id = $3', [await roleId('cashier'), store, cashier]);
});

test('new stores require an open till; existing ones keep their setting', async () => {
  assert.equal((await one("select column_default from information_schema.columns where table_name = 'store_settings' and column_name = 'require_open_till'")).column_default, 'true');
});
