// Support → Message the team, with two sample conversations.
type Mock = (svc: string, key: string, value: unknown) => void;
export default function (mock: Mock) {
  const ago = (h: number) => new Date(Date.now() - h * 3600_000).toISOString();
  mock('SupportService', 'list', [
    { id: 't1', kind: 'feature', subject: 'Print a barcode label for each product', status: 'planned', unread: true, last_message_at: ago(3) },
    { id: 't2', kind: 'problem', subject: 'Scanner adds the same item twice', status: 'done', unread: false, last_message_at: ago(50) },
  ]);
  mock('SupportService', 'get', { thread: { id: 't1', kind: 'feature', subject: 'Print a barcode label for each product', status: 'planned' }, messages: [
    { id: 'm1', from_team: false, body: 'Most of my goods come without barcodes. If I could print a small label for each product I could scan everything at the counter.', created_at: ago(30) },
    { id: 'm2', from_team: true, body: "Great idea, Ada. We're adding label printing for 58 mm printers next. We'll let you know here when it's ready.", created_at: ago(3) },
  ] });
}
