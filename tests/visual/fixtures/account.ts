// Settings → Daily email and Privacy & data. ?deleting=1 shows a scheduled deletion.
type Mock = (svc: string, key: string, value: unknown) => void;
export default function (mock: Mock) {
  const deleting = new URLSearchParams(location.search).get('deleting') === '1';
  mock('AccountService', 'getDailyEmail', true);
  mock('AccountService', 'getDeletion', { owner: true, name: 'Ada Supermarket', requested_at: deleting ? '2026-10-30T08:00:00Z' : null, due_at: deleting ? '2026-11-29T08:00:00Z' : null });
}
