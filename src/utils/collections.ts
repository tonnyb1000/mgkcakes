import type { CakeOrder, PaymentTransaction, WalkInSaleInput } from '../types/order';
import { getKampalaToday } from './dateKampala';

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function generatePaymentId(dateStr: string = getKampalaToday()): string {
  const compactDate = dateStr.replace(/-/g, '').slice(0, 8) || '00000000';
  const length = 6;
  let suffix = '';

  if (typeof globalThis.crypto !== 'undefined' && globalThis.crypto.getRandomValues) {
    const bytes = new Uint8Array(length);
    globalThis.crypto.getRandomValues(bytes);
    for (let i = 0; i < length; i += 1) {
      suffix += ALPHABET[bytes[i] % ALPHABET.length];
    }
  } else {
    for (let i = 0; i < length; i += 1) {
      suffix += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
    }
  }

  return `PAY-${compactDate}-${suffix}`;
}

export interface DailyCollectionsSummary {
  date: string;
  orderDepositsUgx: number;
  laterOrderPaymentsUgx: number;
  walkInSalesUgx: number;
  totalCollectedUgx: number;
  items: PaymentTransaction[];
}

export function summarizeDailyCollections(
  payments: PaymentTransaction[],
  date: string
): DailyCollectionsSummary {
  const items = payments
    .filter((p) => p.receivedDate === date)
    .sort((a, b) => {
      if (a.receivedTime !== b.receivedTime) {
        return a.receivedTime.localeCompare(b.receivedTime);
      }
      return a.receivedAt.localeCompare(b.receivedAt);
    });

  let orderDepositsUgx = 0;
  let laterOrderPaymentsUgx = 0;
  let walkInSalesUgx = 0;

  for (const item of items) {
    if (item.kind === 'order_deposit') {
      orderDepositsUgx += item.amountUgx;
    } else if (item.kind === 'order_balance') {
      laterOrderPaymentsUgx += item.amountUgx;
    } else if (item.kind === 'walk_in') {
      walkInSalesUgx += item.amountUgx;
    }
  }

  return {
    date,
    orderDepositsUgx,
    laterOrderPaymentsUgx,
    walkInSalesUgx,
    totalCollectedUgx: orderDepositsUgx + laterOrderPaymentsUgx + walkInSalesUgx,
    items,
  };
}

/**
 * Returns the portion of order.amountPaidUgx that has no corresponding dated payment
 * transaction in `payments`. Used to flag historical/legacy amounts for review without
 * inventing payment dates.
 */
export function getUnrecordedHistoricalAmount(
  order: CakeOrder,
  payments: PaymentTransaction[]
): number {
  if (order.amountPaidUgx <= 0) return 0;
  const recordedSum = payments
    .filter((p) => p.orderId === order.orderId)
    .reduce((sum, p) => sum + p.amountUgx, 0);
  return Math.max(0, order.amountPaidUgx - recordedSum);
}

export type WalkInValidationErrors = Partial<Record<keyof WalkInSaleInput, string>>;

export function validateWalkInSale(input: WalkInSaleInput): WalkInValidationErrors {
  const errors: WalkInValidationErrors = {};
  if (!input.description.trim()) {
    errors.description = 'Cake description is required.';
  }
  if (!Number.isFinite(input.amountUgx) || input.amountUgx <= 0) {
    errors.amountUgx = 'Amount received must be greater than zero.';
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.receivedDate)) {
    errors.receivedDate = 'Date is required.';
  }
  if (!/^\d{2}:\d{2}$/.test(input.receivedTime)) {
    errors.receivedTime = 'Time is required (HH:MM).';
  }
  return errors;
}
