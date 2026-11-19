import type { CakeOrder, PaymentTransaction } from '../types/order';
import { formatUgx } from './currency';
import { formatDateDisplay, formatTimestampKampala } from './dateKampala';

export const SHOP_NAME: string =
  (import.meta.env.VITE_SHOP_NAME as string | undefined)?.trim() || 'MGK Cakes';

export function escapeHtml(value: string | number | undefined | null): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function getReceiptPaymentMethodLabel(method?: string): string {
  if (method === 'cash') return 'Cash';
  if (method === 'mobile_money') return 'Mobile Money';
  return 'Method not recorded';
}

export function getReceiptFileName(order: CakeOrder): string {
  return `receipt-${order.orderId}.html`;
}

interface ReceiptLine {
  label: string;
  value: string;
}

export function getReceiptDetailLines(order: CakeOrder): ReceiptLine[] {
  const lines: ReceiptLine[] = [];
  const add = (label: string, value?: string) => {
    if (value && value.trim()) lines.push({ label, value: value.trim() });
  };

  add('Cake', order.description);
  if (order.tierDetails && order.tierDetails.length > 0) {
    const tiers = [...order.tierDetails]
      .sort((a, b) => b.tierNumber - a.tierNumber)
      .map((t) => `Tier ${t.tierNumber} (${t.shape}): ${formatUgx(t.priceUgx)}`)
      .join('; ');
    add('Tiers', tiers);
  } else {
    add('Tiers', order.tiers);
  }
  add('Shape', order.shape);
  add('Size', order.size);
  add('Design', order.design);
  add('Colour', order.colour);
  add(
    'Icing',
    order.icingType === 'other'
      ? `Other${order.icingOtherNote ? `: ${order.icingOtherNote}` : ''}`
      : order.icingType.charAt(0).toUpperCase() + order.icingType.slice(1)
  );
  add('Words / Decoration', order.inscriptionOrDecoration);
  return lines;
}

/**
 * Builds a standalone, print-ready HTML receipt document for download.
 * All dynamic values are HTML-escaped.
 */
export function buildReceiptHtml(
  order: CakeOrder,
  orderPayments: PaymentTransaction[],
  shopName: string = SHOP_NAME
): string {
  const detailRows = getReceiptDetailLines(order)
    .map(
      (l) =>
        `<tr><th>${escapeHtml(l.label)}</th><td>${escapeHtml(l.value)}</td></tr>`
    )
    .join('');

  const paymentRows =
    orderPayments.length > 0
      ? orderPayments
          .map(
            (p) =>
              `<tr><td>${escapeHtml(formatDateDisplay(p.receivedDate))} ${escapeHtml(
                p.receivedTime
              )}</td><td>${escapeHtml(
                p.kind === 'order_deposit' ? 'Deposit' : 'Balance payment'
              )} (${escapeHtml(getReceiptPaymentMethodLabel(p.paymentMethod))})</td><td class="num">${escapeHtml(
                formatUgx(p.amountUgx)
              )}</td></tr>`
          )
          .join('')
      : '<tr><td colspan="3">No payment transactions recorded.</td></tr>';

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Receipt ${escapeHtml(order.orderId)}</title>
<style>
  body { font-family: Arial, Helvetica, sans-serif; color: #111; margin: 0; padding: 16px; }
  .receipt { max-width: 380px; margin: 0 auto; }
  h1 { font-size: 20px; text-align: center; margin: 0 0 2px; }
  .sub { text-align: center; font-size: 12px; margin-bottom: 10px; }
  .oid { text-align: center; font-weight: bold; font-family: monospace; font-size: 15px; margin: 8px 0; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; margin: 8px 0; }
  th { text-align: left; width: 34%; vertical-align: top; padding: 3px 4px 3px 0; }
  td { padding: 3px 0; vertical-align: top; }
  td.num { text-align: right; white-space: nowrap; }
  .totals td, .totals th { font-size: 14px; }
  .balance { font-weight: bold; border-top: 1px solid #111; }
  hr { border: none; border-top: 1px dashed #555; margin: 10px 0; }
  .note { font-size: 11px; text-align: center; margin-top: 10px; }
  @media print { body { padding: 0; } @page { margin: 8mm; } }
</style>
</head>
<body>
<div class="receipt">
  <h1>${escapeHtml(shopName)}</h1>
  <div class="sub">Order Receipt</div>
  <div class="oid">${escapeHtml(order.orderId)}</div>
  <table>
    <tr><th>Order taken</th><td>${escapeHtml(formatTimestampKampala(order.createdAt))} (Kampala)</td></tr>
    <tr><th>Customer</th><td>${escapeHtml(order.customerName)}</td></tr>
    <tr><th>Phone</th><td>${escapeHtml(order.customerPhone)}</td></tr>
    <tr><th>Pickup</th><td>${escapeHtml(formatDateDisplay(order.pickupDate))}${
      order.pickupTime ? ` at ${escapeHtml(order.pickupTime)}` : ''
    }</td></tr>
  </table>
  <hr />
  <table>${detailRows}</table>
  <hr />
  <table class="totals">
    <tr><th>Total price</th><td class="num">${escapeHtml(formatUgx(order.totalPriceUgx))}</td></tr>
    <tr><th>Amount paid</th><td class="num">${escapeHtml(formatUgx(order.amountPaidUgx))}</td></tr>
    <tr class="balance"><th>Balance due</th><td class="num">${escapeHtml(formatUgx(order.balanceUgx))}</td></tr>
  </table>
  <table>${paymentRows}</table>
  <hr />
  <div class="note">Served by ${escapeHtml(order.createdByEmail)}<br />
  Payments are recorded in shop. No online payment was processed.<br />
  Please keep this receipt for pickup.</div>
</div>
</body>
</html>`;
}

export function downloadReceipt(
  order: CakeOrder,
  orderPayments: PaymentTransaction[],
  shopName: string = SHOP_NAME
): void {
  const html = buildReceiptHtml(order, orderPayments, shopName);
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.setAttribute('download', getReceiptFileName(order));
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
