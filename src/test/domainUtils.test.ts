import { describe, expect, it } from 'vitest';
import {
  getUnrecordedHistoricalAmount,
  summarizeDailyCashFlow,
  summarizeDailyCollections,
  validateCashFlowEntry,
  validateWalkInSale,
} from '../utils/collections';
import {
  calculateBalanceUgx,
  calculateTiersTotalUgx,
  QUICK_TIER_PRICES_UGX,
  validateOrderInput,
} from '../utils/currency';
import { buildOrdersCsv, sanitizeCsvCell, sanitizePhoneForCsv } from '../utils/csvExport';
import {
  addDaysToDateString,
  formatKampalaDateString,
  isOlderThanMonths,
} from '../utils/dateKampala';
import { generateOrderId } from '../utils/orderId';
import type { CakeOrder, CakeOrderInput } from '../types/order';

function makeValidInput(overrides: Partial<CakeOrderInput> = {}): CakeOrderInput {
  return {
    customerName: 'Test Customer',
    customerPhone: '0772111222',
    orderDate: '2026-11-17',
    pickupDate: '2026-11-20',
    pickupTime: '14:00',
    description: 'Vanilla sponge cake',
    design: 'Simple swirl',
    colour: 'White',
    icingType: 'buttercream',
    icingOtherNote: '',
    inscriptionOrDecoration: 'Happy Birthday',
    size: '8 inch',
    shape: 'Round',
    tiers: '1',
    totalPriceUgx: 150000,
    amountPaidUgx: 50000,
    ...overrides,
  };
}

describe('currency & validation', () => {
  it('calculates outstanding balance and zero when fully paid', () => {
    expect(calculateBalanceUgx(150000, 50000)).toBe(100000);
    expect(calculateBalanceUgx(150000, 150000)).toBe(0);
  });

  it('rejects negative amounts and deposit exceeding total', () => {
    const negTotal = validateOrderInput(makeValidInput({ totalPriceUgx: -1000 }));
    expect(negTotal.totalPriceUgx).toBeDefined();

    const negPaid = validateOrderInput(makeValidInput({ amountPaidUgx: -500 }));
    expect(negPaid.amountPaidUgx).toBeDefined();

    const overPaid = validateOrderInput(
      makeValidInput({ totalPriceUgx: 100000, amountPaidUgx: 120000 })
    );
    expect(overPaid.amountPaidUgx).toBeDefined();
  });

  it('calculates total from tier prices and validates tier details', () => {
    expect(QUICK_TIER_PRICES_UGX).toEqual([
      25000, 35000, 40000, 50000, 60000, 70000, 80000, 100000, 120000,
    ]);
    expect(
      calculateTiersTotalUgx([
        { tierNumber: 1, shape: 'Round', priceUgx: 80000 },
        { tierNumber: 2, shape: 'Square', priceUgx: 50000 },
      ])
    ).toBe(130000);

    const badTier = validateOrderInput(
      makeValidInput({
        tierDetails: [{ tierNumber: 1, shape: 'Round', priceUgx: -100 }],
      })
    );
    expect(badTier.tierDetails).toBeDefined();
  });

  it('rejects pickup date earlier than order date', () => {
    const errors = validateOrderInput(
      makeValidInput({ orderDate: '2026-11-20', pickupDate: '2026-11-19' })
    );
    expect(errors.pickupDate).toBeDefined();
  });
});

describe('Africa/Kampala dates', () => {
  it('formats UTC timestamp into Kampala (UTC+3) calendar date', () => {
    // 2026-11-17T22:30:00Z is 2026-11-18T01:30:00+03:00 in Africa/Kampala
    const utcLateNight = new Date('2026-11-17T22:30:00Z');
    expect(formatKampalaDateString(utcLateNight)).toBe('2026-11-18');
  });

  it('adds calendar days without timezone drift', () => {
    expect(addDaysToDateString('2026-11-30', 1)).toBe('2026-12-01');
  });

  it('detects orders older than 12 months', () => {
    expect(isOlderThanMonths('2025-11-16', 12, '2026-11-17')).toBe(true);
    expect(isOlderThanMonths('2025-11-18', 12, '2026-11-17')).toBe(false);
  });
});

describe('orderId', () => {
  it('generates stable formatted unique order IDs', () => {
    const a = generateOrderId('2026-11-17');
    const b = generateOrderId('2026-11-17');
    expect(a).toMatch(/^ORD-20261117-[A-Z0-9]{6}$/);
    expect(a).not.toBe(b);
  });
});

describe('CSV export & formula injection protection', () => {
  it('neutralizes formula prefixes and escapes quotes', () => {
    expect(sanitizeCsvCell('=CMD()')).toBe('"\'=CMD()"');
    expect(sanitizeCsvCell('+1+1')).toBe('"\'+1+1"');
    expect(sanitizeCsvCell('-2+3')).toBe('"\'-2+3"');
    expect(sanitizeCsvCell('@SUM(A1)')).toBe('"\'@SUM(A1)"');
    expect(sanitizeCsvCell('He said "Hi"')).toBe('"He said ""Hi"""');
  });

  it('preserves phone numbers safely as text', () => {
    expect(sanitizePhoneForCsv('0772123456')).toBe('"\'0772123456"');
    expect(sanitizePhoneForCsv('+256772123456')).toBe('"\'+256772123456"');
  });

  it('builds UTF-8 BOM CSV with all order fields', () => {
    const sample: CakeOrder = {
      ...makeValidInput(),
      tierDetails: [
        { tierNumber: 1, shape: 'Round', priceUgx: 100000 },
        { tierNumber: 2, shape: 'Heart', priceUgx: 50000 },
      ],
      orderId: 'ORD-20261117-ABC123',
      balanceUgx: 100000,
      pickupStatus: 'waiting',
      createdAt: '2026-11-17T10:00:00+03:00',
      updatedAt: '2026-11-17T10:00:00+03:00',
      createdByUid: 'u1',
      createdByEmail: 'staff@example.invalid',
      updatedByUid: 'u1',
      updatedByEmail: 'staff@example.invalid',
    };
    const csv = buildOrdersCsv([sample]);
    expect(csv.startsWith('\uFEFF')).toBe(true);
    expect(csv).toContain('ORD-20261117-ABC123');
    expect(csv).toContain('"\'0772111222"');
    expect(csv).toContain('Waiting for pickup');
    expect(csv).toContain('Tier 1 (Round): UGX 100000 | Tier 2 (Heart): UGX 50000');
  });
});

describe('Daily Collections & walk-in validation', () => {
  it('summarizes deposits, later balance payments, and walk-in sales for a given date', () => {
    const payments = [
      {
        paymentId: 'PAY-1',
        kind: 'order_deposit' as const,
        orderId: 'ORD-1',
        customerName: 'A',
        description: 'Cake A',
        amountUgx: 50000,
        receivedDate: '2026-11-18',
        receivedTime: '09:00',
        receivedAt: '2026-11-18T09:00:00+03:00',
        recordedByUid: 'u1',
        recordedByEmail: 's@shop.example',
        recordedByName: 'Staff',
      },
      {
        paymentId: 'PAY-2',
        kind: 'order_balance' as const,
        orderId: 'ORD-2',
        customerName: 'B',
        description: 'Cake B',
        amountUgx: 70000,
        receivedDate: '2026-11-18',
        receivedTime: '14:00',
        receivedAt: '2026-11-18T14:00:00+03:00',
        recordedByUid: 'u1',
        recordedByEmail: 's@shop.example',
        recordedByName: 'Staff',
      },
      {
        paymentId: 'PAY-3',
        kind: 'walk_in' as const,
        orderId: '',
        customerName: 'Walk-in Customer',
        description: 'Cupcakes',
        amountUgx: 30000,
        receivedDate: '2026-11-18',
        receivedTime: '15:30',
        receivedAt: '2026-11-18T15:30:00+03:00',
        recordedByUid: 'u1',
        recordedByEmail: 's@shop.example',
        recordedByName: 'Staff',
      },
      {
        paymentId: 'PAY-4',
        kind: 'order_deposit' as const,
        orderId: 'ORD-3',
        customerName: 'C',
        description: 'Other day',
        amountUgx: 100000,
        receivedDate: '2026-11-17',
        receivedTime: '10:00',
        receivedAt: '2026-11-17T10:00:00+03:00',
        recordedByUid: 'u1',
        recordedByEmail: 's@shop.example',
        recordedByName: 'Staff',
      },
    ];

    const summary = summarizeDailyCollections(payments, '2026-11-18');
    expect(summary.orderDepositsUgx).toBe(50000);
    expect(summary.laterOrderPaymentsUgx).toBe(70000);
    expect(summary.walkInSalesUgx).toBe(30000);
    expect(summary.totalCollectedUgx).toBe(150000);
    expect(summary.items).toHaveLength(3);
  });

  it('flags historical order amounts without inventing payment dates', () => {
    const legacyOrder: CakeOrder = {
      ...makeValidInput({ totalPriceUgx: 200000, amountPaidUgx: 120000 }),
      orderId: 'ORD-LEGACY',
      balanceUgx: 80000,
      pickupStatus: 'waiting',
      createdAt: '2025-01-10T10:00:00+03:00',
      updatedAt: '2025-01-10T10:00:00+03:00',
      createdByUid: 'u1',
      createdByEmail: 's@shop.example',
      updatedByUid: 'u1',
      updatedByEmail: 's@shop.example',
    };
    expect(getUnrecordedHistoricalAmount(legacyOrder, [])).toBe(120000);
  });

  it('validates walk-in sale inputs', () => {
    const bad = validateWalkInSale({
      description: '',
      amountUgx: 0,
      paymentMethod: 'cash',
      receivedDate: '2026-11-18',
      receivedTime: '12:00',
    });
    expect(bad.description).toBeDefined();
    expect(bad.amountUgx).toBeDefined();
  });

  it('excludes deleted orders from daily collections, separates cash and mobile money, and does not guess older records', () => {
    const deletedOrder: CakeOrder = {
      ...makeValidInput({ totalPriceUgx: 200000, amountPaidUgx: 100000 }),
      orderId: 'ORD-DEL-1',
      orderDate: '2026-11-10',
      pickupDate: '2026-11-15',
      balanceUgx: 100000,
      pickupStatus: 'waiting',
      createdAt: '2026-11-10T09:00:00+03:00',
      updatedAt: '2026-11-18T12:00:00+03:00',
      createdByUid: 'u1',
      createdByEmail: 's@shop.example',
      updatedByUid: 'admin1',
      updatedByEmail: 'admin@shop.example',
      deletedAt: '2026-11-18T12:00:00+03:00',
      deletedByUid: 'admin1',
      deletedByEmail: 'admin@shop.example',
      deletedByName: 'Admin User',
    };

    const payments = [
      {
        paymentId: 'PAY-DEL-1',
        kind: 'order_deposit' as const,
        paymentMethod: 'cash' as const,
        orderId: 'ORD-DEL-1',
        customerName: 'Deleted Customer',
        description: 'Cake',
        amountUgx: 100000,
        receivedDate: '2026-11-10',
        receivedTime: '09:00',
        receivedAt: '2026-11-10T09:00:00+03:00',
        recordedByUid: 'u1',
        recordedByEmail: 's@shop.example',
        recordedByName: 'Staff',
      },
      {
        paymentId: 'PAY-KEEP-1',
        kind: 'order_balance' as const,
        paymentMethod: 'mobile_money' as const,
        orderId: 'ORD-ACTIVE-1',
        customerName: 'Active Customer',
        description: 'Active Cake',
        amountUgx: 60000,
        receivedDate: '2026-11-10',
        receivedTime: '11:00',
        receivedAt: '2026-11-10T11:00:00+03:00',
        recordedByUid: 'u1',
        recordedByEmail: 's@shop.example',
        recordedByName: 'Staff',
      },
      {
        paymentId: 'PAY-OLD-NOMETHOD',
        kind: 'walk_in' as const,
        // Older record with no paymentMethod -> must NOT be guessed into cash or mobile_money
        orderId: '',
        customerName: 'Walk-in Customer',
        description: 'Older walk-in',
        amountUgx: 20000,
        receivedDate: '2026-11-10',
        receivedTime: '11:30',
        receivedAt: '2026-11-10T11:30:00+03:00',
        recordedByUid: 'u1',
        recordedByEmail: 's@shop.example',
        recordedByName: 'Staff',
      },
    ];

    const pastSummary = summarizeDailyCollections(payments, '2026-11-10', [deletedOrder]);
    expect(pastSummary.totalCollectedUgx).toBe(80000);
    expect(pastSummary.items).toHaveLength(2);
    expect(pastSummary.excludedDeletedItems).toHaveLength(1);
    expect(pastSummary.excludedDeletedItems[0].deletedOrder.deletedByName).toBe('Admin User');

    const cashFlowEntries = [
      {
        entryId: 'CF-1',
        type: 'other_sale' as const,
        paymentMethod: 'cash' as const,
        description: 'Birthday candles',
        amountUgx: 15000,
        entryDate: '2026-11-10',
        entryTime: '12:00',
        createdAt: '2026-11-10T12:00:00+03:00',
        recordedByUid: 'u1',
        recordedByEmail: 's@shop.example',
        recordedByName: 'Staff',
      },
      {
        entryId: 'CF-2',
        type: 'expense' as const,
        paymentMethod: 'cash' as const,
        description: 'Cooking gas',
        amountUgx: 90000,
        entryDate: '2026-11-10',
        entryTime: '13:00',
        createdAt: '2026-11-10T13:00:00+03:00',
        recordedByUid: 'u1',
        recordedByEmail: 's@shop.example',
        recordedByName: 'Staff',
      },
      {
        entryId: 'CF-3',
        type: 'expense' as const,
        paymentMethod: 'mobile_money' as const,
        description: 'Delivery boda',
        amountUgx: 10000,
        entryDate: '2026-11-10',
        entryTime: '13:30',
        createdAt: '2026-11-10T13:30:00+03:00',
        recordedByUid: 'u1',
        recordedByEmail: 's@shop.example',
        recordedByName: 'Staff',
      },
    ];

    const cfSummary = summarizeDailyCashFlow(payments, cashFlowEntries, '2026-11-10', [deletedOrder]);
    // Cash: 15,000 in - 90,000 out = -75,000
    expect(cfSummary.cash).toEqual({
      moneyInUgx: 15000,
      moneyOutUgx: 90000,
      netMovementUgx: -75000,
    });
    // Mobile Money: 60,000 in - 10,000 out = +50,000
    expect(cfSummary.mobileMoney).toEqual({
      moneyInUgx: 60000,
      moneyOutUgx: 10000,
      netMovementUgx: 50000,
    });
    // Older record without paymentMethod stays in unspecified, not guessed
    expect(cfSummary.unspecified).toEqual({
      moneyInUgx: 20000,
      moneyOutUgx: 0,
      netMovementUgx: 20000,
    });
    // Combined: 95,000 in - 100,000 out = -5,000
    expect(cfSummary.totalMoneyInUgx).toBe(95000);
    expect(cfSummary.expensesOutUgx).toBe(100000);
    expect(cfSummary.netMovementUgx).toBe(-5000);

    const badCf = validateCashFlowEntry({
      type: 'expense',
      paymentMethod: 'cash',
      description: '',
      amountUgx: 0,
      entryDate: '2026-11-10',
      entryTime: '13:00',
    });
    expect(badCf.description).toBeDefined();
    expect(badCf.amountUgx).toBeDefined();
  });
});
