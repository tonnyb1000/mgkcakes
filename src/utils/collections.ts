import type {
  CakeOrder,
  CashFlowEntry,
  CashFlowEntryInput,
  PaymentTransaction,
  WalkInSaleInput,
} from '../types/order';
import { getKampalaToday } from './dateKampala';

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function generatePrefixedId(prefix: string, dateStr: string = getKampalaToday()): string {
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

  return `${prefix}-${compactDate}-${suffix}`;
}

export function generatePaymentId(dateStr: string = getKampalaToday()): string {
  return generatePrefixedId('PAY', dateStr);
}

export function generateCashFlowId(dateStr: string = getKampalaToday()): string {
  return generatePrefixedId('CF', dateStr);
}

export interface DailyCollectionsSummary {
  date: string;
  orderDepositsUgx: number;
  laterOrderPaymentsUgx: number;
  walkInSalesUgx: number;
  totalCollectedUgx: number;
  cashUgx: number;
  mobileMoneyUgx: number;
  unspecifiedMethodUgx: number;
  items: PaymentTransaction[];
  excludedDeletedItems: Array<{
    payment: PaymentTransaction;
    deletedOrder: CakeOrder;
  }>;
}

export function summarizeDailyCollections(
  payments: PaymentTransaction[],
  date: string,
  orders: CakeOrder[] = []
): DailyCollectionsSummary {
  const deletedOrderMap = new Map<string, CakeOrder>();
  for (const order of orders) {
    if (order.deletedAt) {
      deletedOrderMap.set(order.orderId, order);
    }
  }

  const allForDate = payments
    .filter((p) => p.receivedDate === date)
    .sort((a, b) => {
      if (a.receivedTime !== b.receivedTime) {
        return a.receivedTime.localeCompare(b.receivedTime);
      }
      return a.receivedAt.localeCompare(b.receivedAt);
    });

  const items: PaymentTransaction[] = [];
  const excludedDeletedItems: Array<{ payment: PaymentTransaction; deletedOrder: CakeOrder }> = [];

  let orderDepositsUgx = 0;
  let laterOrderPaymentsUgx = 0;
  let walkInSalesUgx = 0;
  let cashUgx = 0;
  let mobileMoneyUgx = 0;
  let unspecifiedMethodUgx = 0;

  for (const item of allForDate) {
    const deletedOrder = item.orderId ? deletedOrderMap.get(item.orderId) : undefined;
    if (deletedOrder) {
      excludedDeletedItems.push({ payment: item, deletedOrder });
      continue;
    }

    items.push(item);
    if (item.kind === 'order_deposit') {
      orderDepositsUgx += item.amountUgx;
    } else if (item.kind === 'order_balance') {
      laterOrderPaymentsUgx += item.amountUgx;
    } else if (item.kind === 'walk_in') {
      walkInSalesUgx += item.amountUgx;
    }

    if (item.paymentMethod === 'cash') {
      cashUgx += item.amountUgx;
    } else if (item.paymentMethod === 'mobile_money') {
      mobileMoneyUgx += item.amountUgx;
    } else {
      unspecifiedMethodUgx += item.amountUgx;
    }
  }

  return {
    date,
    orderDepositsUgx,
    laterOrderPaymentsUgx,
    walkInSalesUgx,
    totalCollectedUgx: orderDepositsUgx + laterOrderPaymentsUgx + walkInSalesUgx,
    cashUgx,
    mobileMoneyUgx,
    unspecifiedMethodUgx,
    items,
    excludedDeletedItems,
  };
}

export interface WalkInSalesSummary {
  items: PaymentTransaction[];
  cashUgx: number;
  mobileMoneyUgx: number;
  unspecifiedMethodUgx: number;
  totalUgx: number;
}

export function summarizeWalkInSales(
  payments: PaymentTransaction[],
  date?: string
): WalkInSalesSummary {
  const items = payments
    .filter((p) => p.kind === 'walk_in' && (!date || p.receivedDate === date))
    .sort((a, b) => {
      if (a.receivedDate !== b.receivedDate) {
        return b.receivedDate.localeCompare(a.receivedDate);
      }
      if (a.receivedTime !== b.receivedTime) {
        return b.receivedTime.localeCompare(a.receivedTime);
      }
      return b.receivedAt.localeCompare(a.receivedAt);
    });

  let cashUgx = 0;
  let mobileMoneyUgx = 0;
  let unspecifiedMethodUgx = 0;

  for (const item of items) {
    if (item.paymentMethod === 'cash') {
      cashUgx += item.amountUgx;
    } else if (item.paymentMethod === 'mobile_money') {
      mobileMoneyUgx += item.amountUgx;
    } else {
      unspecifiedMethodUgx += item.amountUgx;
    }
  }

  return {
    items,
    cashUgx,
    mobileMoneyUgx,
    unspecifiedMethodUgx,
    totalUgx: cashUgx + mobileMoneyUgx + unspecifiedMethodUgx,
  };
}

export interface MethodCashFlowTotals {
  moneyInUgx: number;
  moneyOutUgx: number;
  netMovementUgx: number;
}

export interface DailyCashFlowSummary {
  date: string;
  orderPaymentsInUgx: number;
  walkInSalesInUgx: number;
  otherSalesInUgx: number;
  totalMoneyInUgx: number;
  expensesOutUgx: number;
  netMovementUgx: number;
  cash: MethodCashFlowTotals;
  mobileMoney: MethodCashFlowTotals;
  unspecified: MethodCashFlowTotals;
  cashFlowItems: CashFlowEntry[];
}

function createEmptyMethodTotals(): MethodCashFlowTotals {
  return { moneyInUgx: 0, moneyOutUgx: 0, netMovementUgx: 0 };
}

export function summarizeDailyCashFlow(
  payments: PaymentTransaction[],
  cashFlowEntries: CashFlowEntry[],
  date: string,
  orders: CakeOrder[] = []
): DailyCashFlowSummary {
  const collections = summarizeDailyCollections(payments, date, orders);
  const orderPaymentsInUgx =
    collections.orderDepositsUgx + collections.laterOrderPaymentsUgx;
  const walkInSalesInUgx = collections.walkInSalesUgx;

  const cash = createEmptyMethodTotals();
  const mobileMoney = createEmptyMethodTotals();
  const unspecified = createEmptyMethodTotals();

  const pickBucket = (method?: string): MethodCashFlowTotals => {
    if (method === 'cash') return cash;
    if (method === 'mobile_money') return mobileMoney;
    return unspecified;
  };

  for (const item of collections.items) {
    pickBucket(item.paymentMethod).moneyInUgx += item.amountUgx;
  }

  const cashFlowItems = cashFlowEntries
    .filter((e) => e.entryDate === date)
    .sort((a, b) => {
      if (a.entryTime !== b.entryTime) {
        return a.entryTime.localeCompare(b.entryTime);
      }
      return a.createdAt.localeCompare(b.createdAt);
    });

  let otherSalesInUgx = 0;
  let expensesOutUgx = 0;

  for (const entry of cashFlowItems) {
    const bucket = pickBucket(entry.paymentMethod);
    if (entry.type === 'other_sale') {
      otherSalesInUgx += entry.amountUgx;
      bucket.moneyInUgx += entry.amountUgx;
    } else if (entry.type === 'expense') {
      expensesOutUgx += entry.amountUgx;
      bucket.moneyOutUgx += entry.amountUgx;
    }
  }

  cash.netMovementUgx = cash.moneyInUgx - cash.moneyOutUgx;
  mobileMoney.netMovementUgx = mobileMoney.moneyInUgx - mobileMoney.moneyOutUgx;
  unspecified.netMovementUgx = unspecified.moneyInUgx - unspecified.moneyOutUgx;

  const totalMoneyInUgx = orderPaymentsInUgx + walkInSalesInUgx + otherSalesInUgx;
  const netMovementUgx = totalMoneyInUgx - expensesOutUgx;

  return {
    date,
    orderPaymentsInUgx,
    walkInSalesInUgx,
    otherSalesInUgx,
    totalMoneyInUgx,
    expensesOutUgx,
    netMovementUgx,
    cash,
    mobileMoney,
    unspecified,
    cashFlowItems,
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
  if (order.deletedAt || order.amountPaidUgx <= 0) return 0;
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
  if (input.paymentMethod !== 'cash' && input.paymentMethod !== 'mobile_money') {
    errors.paymentMethod = 'Select Cash or Mobile Money.';
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.receivedDate)) {
    errors.receivedDate = 'Date is required.';
  }
  if (!/^\d{2}:\d{2}$/.test(input.receivedTime)) {
    errors.receivedTime = 'Time is required (HH:MM).';
  }
  return errors;
}

export type CashFlowValidationErrors = Partial<Record<keyof CashFlowEntryInput, string>>;

export function validateCashFlowEntry(input: CashFlowEntryInput): CashFlowValidationErrors {
  const errors: CashFlowValidationErrors = {};
  if (input.type !== 'other_sale' && input.type !== 'expense') {
    errors.type = 'Transaction type must be Other Sale or Expense.';
  }
  if (input.paymentMethod !== 'cash' && input.paymentMethod !== 'mobile_money') {
    errors.paymentMethod = 'Select Cash or Mobile Money.';
  }
  if (!input.description.trim()) {
    errors.description = 'Description is required.';
  }
  if (!Number.isFinite(input.amountUgx) || input.amountUgx <= 0) {
    errors.amountUgx = 'Amount must be greater than zero.';
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.entryDate)) {
    errors.entryDate = 'Date is required.';
  }
  if (!/^\d{2}:\d{2}$/.test(input.entryTime)) {
    errors.entryTime = 'Time is required (HH:MM).';
  }
  return errors;
}
