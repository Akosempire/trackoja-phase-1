/**
 * WhatsApp sharing without a server: wa.me links with a ready text. Nigerian
 * numbers are turned into international form (0803… → 234803…).
 */
import { formatMoney } from './format';

export function normalisePhone(raw: string | null | undefined, defaultCountry = '234'): string | null {
  let d = String(raw ?? '').replace(/[^\d+]/g, '');
  if (!d) return null;
  if (d.startsWith('+')) d = d.slice(1);
  else if (d.startsWith('00')) d = d.slice(2);
  else if (d.startsWith('0') && defaultCountry === '234' && d.length === 11) d = `234${d.slice(1)}`;
  else if (d.length === 10 && defaultCountry === '234' && /^[789]/.test(d)) d = `234${d}`;
  d = d.replace(/\D/g, '');
  return d.length >= 10 && d.length <= 15 ? d : null;
}

/** wa.me link; without a number WhatsApp lets you pick the chat. */
export function whatsappLink(phone: string | null, text: string): string {
  const to = normalisePhone(phone);
  return `https://wa.me/${to ?? ''}?text=${encodeURIComponent(text)}`;
}

export interface ReceiptText {
  storeName: string;
  receiptNumber: string;
  date: string;
  items: { name: string; quantity: number; lineTotal: number }[];
  total: number;
  paid: number;
  balance: number;
  currency?: string;
}

const qty = (n: number) => (Number.isInteger(n) ? String(n) : String(+n.toFixed(3)));

export function receiptMessage(r: ReceiptText): string {
  const cur = r.currency ?? 'NGN';
  const lines = [
    `*${r.storeName}*`,
    `Receipt ${r.receiptNumber} · ${r.date}`,
    '',
    ...r.items.slice(0, 30).map((i) => `${qty(i.quantity)} × ${i.name} — ${formatMoney(i.lineTotal, cur)}`),
    ...(r.items.length > 30 ? [`…and ${r.items.length - 30} more`] : []),
    '',
    `*Total: ${formatMoney(r.total, cur)}*`,
    `Paid: ${formatMoney(r.paid, cur)}`,
    ...(r.balance > 0 ? [`Balance to pay: ${formatMoney(r.balance, cur)}`] : []),
    '',
    'Thank you for shopping with us!',
  ];
  return lines.join('\n');
}

export function reminderMessage({ customerName, storeName, amount, currency = 'NGN' }: { customerName: string; storeName: string; amount: number; currency?: string }): string {
  const first = customerName.trim().split(/\s+/)[0] || 'there';
  return [
    `Hello ${first}, good day.`,
    `This is a friendly reminder from ${storeName}: your balance with us is ${formatMoney(amount, currency)}.`,
    'Please let us know when you can pay. Thank you for your custom!',
  ].join('\n');
}
