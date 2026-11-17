import type { CakeOrder } from '../types/order';

const FORMULA_PREFIX_RE = /^[=+\-@\t\r]/;

/**
 * Neutralizes spreadsheet formula injection (CSV injection) and escapes CSV fields safely.
 * Any value starting with =, +, -, @, tab, or carriage return is prefixed with a single quote (').
 */
export function sanitizeCsvCell(value: string | number | undefined | null): string {
  const raw = value === undefined || value === null ? '' : String(value);
  const neutralized = FORMULA_PREFIX_RE.test(raw) ? `'${raw}` : raw;
  const escaped = neutralized.replace(/"/g, '""');
  return `"${escaped}"`;
}

/**
 * Preserves phone numbers as text in Excel (prevents stripping leading zeros or
 * interpreting +256... as a formula).
 */
export function sanitizePhoneForCsv(phone: string): string {
  const trimmed = (phone ?? '').trim();
  if (!trimmed) return '""';
  // Prefixing with a single quote keeps leading zeros and +country codes intact as text
  // and neutralizes formula injection if the phone starts with '+'.
  const safe = trimmed.startsWith("'") ? trimmed : `'${trimmed}`;
  const escaped = safe.replace(/"/g, '""');
  return `"${escaped}"`;
}

const CSV_HEADERS = [
  'Order ID',
  'Customer Name',
  'Customer Phone',
  'Order Date',
  'Pickup Date',
  'Pickup Time',
  'Pickup Status',
  'Cake Description',
  'Design',
  'Colour',
  'Icing Type',
  'Icing Other Note',
  'Words / Decoration on Cake',
  'Size',
  'Shape',
  'Tiers',
  'Tier Breakdown',
  'Total Price (UGX)',
  'Amount Paid (UGX)',
  'Outstanding Balance (UGX)',
  'Created At',
  'Created By',
  'Updated At',
  'Updated By',
] as const;

function formatTierBreakdownForCsv(order: CakeOrder): string {
  if (!order.tierDetails || order.tierDetails.length === 0) {
    return '';
  }
  return order.tierDetails
    .map((t) => `Tier ${t.tierNumber} (${t.shape}): UGX ${Math.round(t.priceUgx)}`)
    .join(' | ');
}

export function buildOrdersCsv(orders: CakeOrder[]): string {
  const headerRow = CSV_HEADERS.map((h) => sanitizeCsvCell(h)).join(',');

  const dataRows = orders.map((order) => {
    const statusLabel = order.pickupStatus === 'picked_up' ? 'Picked up' : 'Waiting for pickup';
    const cells = [
      sanitizeCsvCell(order.orderId),
      sanitizeCsvCell(order.customerName),
      sanitizePhoneForCsv(order.customerPhone),
      sanitizeCsvCell(order.orderDate),
      sanitizeCsvCell(order.pickupDate),
      sanitizeCsvCell(order.pickupTime),
      sanitizeCsvCell(statusLabel),
      sanitizeCsvCell(order.description),
      sanitizeCsvCell(order.design),
      sanitizeCsvCell(order.colour),
      sanitizeCsvCell(order.icingType),
      sanitizeCsvCell(order.icingOtherNote ?? ''),
      sanitizeCsvCell(order.inscriptionOrDecoration),
      sanitizeCsvCell(order.size),
      sanitizeCsvCell(order.shape),
      sanitizeCsvCell(order.tiers),
      sanitizeCsvCell(formatTierBreakdownForCsv(order)),
      sanitizeCsvCell(order.totalPriceUgx),
      sanitizeCsvCell(order.amountPaidUgx),
      sanitizeCsvCell(order.balanceUgx),
      sanitizeCsvCell(order.createdAt),
      sanitizeCsvCell(order.createdByEmail),
      sanitizeCsvCell(order.updatedAt),
      sanitizeCsvCell(order.updatedByEmail),
    ];
    return cells.join(',');
  });

  // Prepend UTF-8 BOM so Microsoft Excel opens Unicode text cleanly.
  return `\uFEFF${[headerRow, ...dataRows].join('\r\n')}`;
}

export function downloadOrdersCsv(orders: CakeOrder[], filename: string): void {
  const csvContent = buildOrdersCsv(orders);
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.setAttribute('download', filename);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
