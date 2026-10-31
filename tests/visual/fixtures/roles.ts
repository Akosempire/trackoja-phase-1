// Settings → Discount limit. ?discount=15 shows a saved limit.
type Mock = (svc: string, key: string, value: unknown) => void;
export default function (mock: Mock) {
  const v = new URLSearchParams(location.search).get('discount');
  mock('StoreRulesService', 'getDiscountLimit', v ? Number(v) : null);
  mock('StoreRulesService', 'setDiscountLimit', async (_s: string, p: number | null) => p);
}
