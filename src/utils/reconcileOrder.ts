import type { CakeOrder, CakeOrderInput } from '../types/order';
import { formatUgx } from './currency';

export interface OrderFieldDiff {
  field: string;
  savedValue: string;
  draftValue: string;
}

function normalizeTiersSummary(
  tiers?: Array<{ tierNumber: number; shape: string; priceUgx: number }>
): string {
  if (!tiers || tiers.length === 0) return '';
  return tiers
    .map((t) => `T${t.tierNumber}:${t.shape.trim()}:${Math.round(t.priceUgx)}`)
    .join('|');
}

export function diffOrderInputAgainstSaved(
  saved: CakeOrder,
  draft: CakeOrderInput
): OrderFieldDiff[] {
  const diffs: OrderFieldDiff[] = [];

  const checkText = (label: string, savedVal: string | undefined, draftVal: string | undefined) => {
    const a = (savedVal ?? '').trim();
    const b = (draftVal ?? '').trim();
    if (a !== b) {
      diffs.push({
        field: label,
        savedValue: a || '(empty)',
        draftValue: b || '(empty)',
      });
    }
  };

  checkText('Customer Name', saved.customerName, draft.customerName);
  checkText('Phone Number', saved.customerPhone, draft.customerPhone);
  checkText('Order Date', saved.orderDate, draft.orderDate);
  checkText('Pickup Date', saved.pickupDate, draft.pickupDate);
  checkText('Pickup Time', saved.pickupTime, draft.pickupTime);
  checkText('Cake Description', saved.description, draft.description);
  checkText('Design', saved.design, draft.design);
  checkText('Colour', saved.colour, draft.colour);
  checkText('Icing Type', saved.icingType, draft.icingType);
  if (saved.icingType === 'other' || draft.icingType === 'other') {
    checkText('Other Icing Note', saved.icingOtherNote, draft.icingOtherNote);
  }
  checkText('Words / Decoration', saved.inscriptionOrDecoration, draft.inscriptionOrDecoration);
  checkText('Size', saved.size, draft.size);
  checkText('Shape', saved.shape, draft.shape);

  const savedTiers = normalizeTiersSummary(saved.tierDetails);
  const draftTiers = normalizeTiersSummary(draft.tierDetails);
  if (savedTiers !== draftTiers) {
    diffs.push({
      field: 'Cake Tiers',
      savedValue: savedTiers || `${saved.tiers || '1'} tier(s)`,
      draftValue: draftTiers || `${draft.tiers || '1'} tier(s)`,
    });
  }

  if (Math.round(saved.totalPriceUgx) !== Math.round(draft.totalPriceUgx)) {
    diffs.push({
      field: 'Total Price (UGX)',
      savedValue: formatUgx(saved.totalPriceUgx),
      draftValue: formatUgx(draft.totalPriceUgx),
    });
  }

  if (Math.round(saved.amountPaidUgx) !== Math.round(draft.amountPaidUgx)) {
    diffs.push({
      field: 'Deposit Paid (UGX)',
      savedValue: formatUgx(saved.amountPaidUgx),
      draftValue: formatUgx(draft.amountPaidUgx),
    });
  }

  return diffs;
}
