import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { App } from '../App';
import {
  OrderReconcileConflictError,
  UnconfiguredOrderRepository,
  type OrderRepository,
} from '../services/orderRepository';
import type {
  CakeOrder,
  CakeOrderInput,
  CashFlowEntry,
  CashFlowEntryInput,
  PaymentMethod,
  PaymentTransaction,
  PickupStatus,
  StaffUser,
  WalkInSaleInput,
} from '../types/order';
import {
  generateCashFlowId,
  generatePaymentId,
  validateCashFlowEntry,
  validateWalkInSale,
} from '../utils/collections';
import { diffOrderInputAgainstSaved } from '../utils/reconcileOrder';
import { calculateBalanceUgx, validateOrderInput } from '../utils/currency';
import {
  addDaysToDateString,
  getKampalaTimeNow,
  getKampalaToday,
} from '../utils/dateKampala';
import { generateOrderId } from '../utils/orderId';
import { buildReceiptHtml } from '../utils/receipt';

/**
 * Test-only in-memory repository for UI workflow verification.
 */
class TestMemoryOrderRepository implements OrderRepository {
  readonly configured = true;
  private orders: CakeOrder[];
  private payments: PaymentTransaction[];
  private cashFlowEntries: CashFlowEntry[];
  private currentUser: StaffUser | null = null;
  private listeners = new Set<(user: StaffUser | null, error?: string) => void>();

  constructor(
    initialOrders: CakeOrder[],
    initialPayments: PaymentTransaction[] = [],
    initialCashFlowEntries: CashFlowEntry[] = []
  ) {
    this.orders = [...initialOrders];
    this.payments = [...initialPayments];
    this.cashFlowEntries = [...initialCashFlowEntries];
  }

  subscribeAuth(callback: (user: StaffUser | null, error?: string) => void): () => void {
    this.listeners.add(callback);
    callback(this.currentUser);
    return () => {
      this.listeners.delete(callback);
    };
  }

  async signIn(email: string, _password?: string): Promise<StaffUser> {
    const isOwner = email.toLowerCase().includes('owner');
    const user: StaffUser = {
      uid: isOwner ? 'owner-1' : 'staff-1',
      email,
      displayName: isOwner ? 'Owner User' : 'Staff User',
      role: isOwner ? 'owner' : 'staff',
      active: true,
    };
    this.currentUser = user;
    for (const cb of this.listeners) cb(user);
    return user;
  }

  async signOut(): Promise<void> {
    this.currentUser = null;
    for (const cb of this.listeners) cb(null);
  }

  async listOrders(user: StaffUser | null): Promise<CakeOrder[]> {
    if (!user) throw new Error('Access denied');
    return [...this.orders];
  }

  async getOrderById(orderId: string, user: StaffUser | null): Promise<CakeOrder | null> {
    if (!user) throw new Error('Access denied');
    return this.orders.find((o) => o.orderId === orderId) ?? null;
  }

  async listPayments(user: StaffUser | null): Promise<PaymentTransaction[]> {
    if (!user) throw new Error('Access denied');
    return [...this.payments];
  }

  async listCashFlowEntries(user: StaffUser | null): Promise<CashFlowEntry[]> {
    if (!user) throw new Error('Access denied');
    return [...this.cashFlowEntries];
  }

  async createOrder(
    input: CakeOrderInput,
    user: StaffUser | null,
    idempotency?: { orderId?: string; paymentId?: string }
  ): Promise<CakeOrder> {
    if (!user) throw new Error('Access denied');
    const errors = validateOrderInput(input);
    const first = Object.values(errors)[0];
    if (first) throw new Error(first);

    const orderId = idempotency?.orderId || generateOrderId(input.orderDate);
    const existing = this.orders.find((o) => o.orderId === orderId);
    if (existing) {
      const diffs = diffOrderInputAgainstSaved(existing, input);
      if (diffs.length > 0) {
        throw new OrderReconcileConflictError(existing, diffs);
      }
      return existing;
    }

    const now = new Date();
    const nowIso = now.toISOString();
    const paid = Math.round(input.amountPaidUgx);
    const receivedDate = getKampalaToday(now);
    const paymentId = paid > 0 ? idempotency?.paymentId || generatePaymentId(receivedDate) : '';
    const order: CakeOrder = {
      orderId,
      customerName: input.customerName.trim(),
      customerPhone: input.customerPhone.trim(),
      orderDate: input.orderDate,
      pickupDate: input.pickupDate,
      pickupTime: input.pickupTime.trim(),
      description: input.description.trim(),
      design: input.design.trim(),
      colour: input.colour.trim(),
      icingType: input.icingType,
      icingOtherNote: input.icingOtherNote ?? '',
      inscriptionOrDecoration: input.inscriptionOrDecoration.trim(),
      size: input.size.trim(),
      shape: input.shape.trim(),
      tiers: input.tiers.trim(),
      ...(input.tierDetails && input.tierDetails.length > 0
        ? { tierDetails: input.tierDetails }
        : {}),
      totalPriceUgx: Math.round(input.totalPriceUgx),
      amountPaidUgx: paid,
      balanceUgx: calculateBalanceUgx(input.totalPriceUgx, paid),
      ...(paymentId ? { lastPaymentId: paymentId } : {}),
      pickupStatus: input.pickupStatus ?? 'waiting',
      createdAt: nowIso,
      updatedAt: nowIso,
      createdByUid: user.uid,
      createdByEmail: user.email,
      updatedByUid: user.uid,
      updatedByEmail: user.email,
    };
    this.orders = [order, ...this.orders];
    if (paid > 0 && paymentId) {
      this.payments = [
        {
          paymentId,
          kind: 'order_deposit',
          paymentMethod: input.depositPaymentMethod ?? 'cash',
          orderId: order.orderId,
          customerName: order.customerName,
          description: order.description,
          amountUgx: paid,
          receivedDate,
          receivedTime: getKampalaTimeNow(now),
          receivedAt: nowIso,
          recordedByUid: user.uid,
          recordedByEmail: user.email,
          recordedByName: user.displayName,
        },
        ...this.payments,
      ];
    }
    return order;
  }

  async updateOrder(
    orderId: string,
    input: CakeOrderInput,
    user: StaffUser | null,
    expectedUpdatedAt?: string
  ): Promise<CakeOrder> {
    if (!user) throw new Error('Access denied');
    const idx = this.orders.findIndex((o) => o.orderId === orderId);
    if (idx === -1) throw new Error('Not found');
    const existing = this.orders[idx];
    if (expectedUpdatedAt && existing.updatedAt !== expectedUpdatedAt) {
      const diffs = diffOrderInputAgainstSaved(existing, {
        ...input,
        amountPaidUgx: existing.amountPaidUgx,
      });
      throw new OrderReconcileConflictError(existing, diffs);
    }
    const paid = existing.amountPaidUgx;
    if (input.totalPriceUgx < paid) {
      throw new Error('Total price cannot be less than the amount already paid.');
    }
    const updated: CakeOrder = {
      ...existing,
      ...input,
      amountPaidUgx: paid,
      balanceUgx: calculateBalanceUgx(input.totalPriceUgx, paid),
      updatedAt: new Date(Date.now() + 1000).toISOString(),
      updatedByUid: user.uid,
      updatedByEmail: user.email,
    };
    this.orders = [...this.orders.slice(0, idx), updated, ...this.orders.slice(idx + 1)];
    return updated;
  }

  async deleteOrder(orderId: string, user: StaffUser | null): Promise<CakeOrder> {
    if (!user || (user.role !== 'owner' && user.role !== 'admin')) {
      throw new Error('Access denied: Only an admin can delete orders.');
    }
    const idx = this.orders.findIndex((o) => o.orderId === orderId);
    if (idx === -1) throw new Error('Not found');
    const existing = this.orders[idx];
    if (existing.deletedAt) return existing;
    const nowIso = new Date().toISOString();
    const deleted: CakeOrder = {
      ...existing,
      deletedAt: nowIso,
      deletedByUid: user.uid,
      deletedByEmail: user.email,
      deletedByName: user.displayName,
      updatedAt: nowIso,
      updatedByUid: user.uid,
      updatedByEmail: user.email,
    };
    this.orders = [...this.orders.slice(0, idx), deleted, ...this.orders.slice(idx + 1)];
    return deleted;
  }

  async updatePickupStatus(
    orderId: string,
    status: PickupStatus,
    user: StaffUser | null,
    options?: { paymentMethod?: PaymentMethod; idempotencyPaymentId?: string }
  ): Promise<{ order: CakeOrder; payment?: PaymentTransaction }> {
    if (!user) throw new Error('Access denied');
    const idx = this.orders.findIndex((o) => o.orderId === orderId);
    if (idx === -1) throw new Error('Not found');
    const existing = this.orders[idx];
    if (existing.deletedAt) throw new Error('Cannot update deleted order');
    const now = new Date();
    const nowIso = now.toISOString();
    const pickedUpDate = getKampalaToday(now);
    const pickedUpTime = getKampalaTimeNow(now);

    if (status === 'picked_up') {
      if (options?.idempotencyPaymentId) {
        const existingPay = this.payments.find(
          (p) => p.paymentId === options.idempotencyPaymentId
        );
        if (existingPay) {
          if (existingPay.orderId === orderId) {
            return { order: existing, payment: existingPay };
          }
          throw new Error('Duplicate payment ID');
        }
      }

      if (existing.pickupStatus === 'picked_up') {
        return { order: existing };
      }

      const outstanding = Math.max(
        0,
        calculateBalanceUgx(existing.totalPriceUgx, existing.amountPaidUgx)
      );

      if (outstanding > 0) {
        const paymentId = options?.idempotencyPaymentId || generatePaymentId(pickedUpDate);
        const payment: PaymentTransaction = {
          paymentId,
          kind: 'order_balance',
          paymentMethod: options?.paymentMethod ?? 'cash',
          orderId,
          customerName: existing.customerName,
          description: existing.description,
          amountUgx: outstanding,
          receivedDate: pickedUpDate,
          receivedTime: pickedUpTime,
          receivedAt: nowIso,
          recordedByUid: user.uid,
          recordedByEmail: user.email,
          recordedByName: user.displayName,
        };
        const updated: CakeOrder = {
          ...existing,
          pickupStatus: 'picked_up',
          pickedUpAt: nowIso,
          pickedUpDate,
          pickedUpTime,
          amountPaidUgx: existing.totalPriceUgx,
          balanceUgx: 0,
          lastPaymentId: paymentId,
          updatedAt: nowIso,
          updatedByUid: user.uid,
          updatedByEmail: user.email,
        };
        this.payments = [payment, ...this.payments];
        this.orders = [...this.orders.slice(0, idx), updated, ...this.orders.slice(idx + 1)];
        return { order: updated, payment };
      }

      const updated: CakeOrder = {
        ...existing,
        pickupStatus: 'picked_up',
        pickedUpAt: nowIso,
        pickedUpDate,
        pickedUpTime,
        updatedAt: nowIso,
        updatedByUid: user.uid,
        updatedByEmail: user.email,
      };
      this.orders = [...this.orders.slice(0, idx), updated, ...this.orders.slice(idx + 1)];
      return { order: updated };
    }

    const updated: CakeOrder = {
      ...existing,
      pickupStatus: 'waiting',
      updatedAt: nowIso,
      updatedByUid: user.uid,
      updatedByEmail: user.email,
    };
    this.orders = [...this.orders.slice(0, idx), updated, ...this.orders.slice(idx + 1)];
    return { order: updated };
  }

  async recordOrderPayment(
    orderId: string,
    amountUgx: number,
    user: StaffUser | null,
    idempotencyPaymentId?: string,
    paymentMethod: PaymentMethod = 'cash'
  ): Promise<{ order: CakeOrder; payment: PaymentTransaction }> {
    if (!user) throw new Error('Access denied');
    const cleanAmount = Math.round(amountUgx);
    if (cleanAmount <= 0) throw new Error('Payment amount must be positive.');
    const paymentId = idempotencyPaymentId || generatePaymentId(getKampalaToday());
    const idx = this.orders.findIndex((o) => o.orderId === orderId);
    if (idx === -1) throw new Error('Not found');
    const existing = this.orders[idx];
    const existingPayment = this.payments.find((p) => p.paymentId === paymentId);
    if (existingPayment) {
      if (existingPayment.orderId === orderId && existingPayment.amountUgx === cleanAmount) {
        return { order: existing, payment: existingPayment };
      }
      throw new Error('Duplicate payment prevented.');
    }
    const nextPaid = existing.amountPaidUgx + cleanAmount;
    if (nextPaid > existing.totalPriceUgx) {
      throw new Error('Exceeds remaining balance.');
    }
    const now = new Date();
    const updated: CakeOrder = {
      ...existing,
      amountPaidUgx: nextPaid,
      balanceUgx: calculateBalanceUgx(existing.totalPriceUgx, nextPaid),
      updatedAt: now.toISOString(),
      updatedByUid: user.uid,
      updatedByEmail: user.email,
    };
    this.orders = [...this.orders.slice(0, idx), updated, ...this.orders.slice(idx + 1)];
    const payment: PaymentTransaction = {
      paymentId,
      kind: 'order_balance',
      paymentMethod,
      orderId,
      customerName: existing.customerName,
      description: existing.description,
      amountUgx: cleanAmount,
      receivedDate: getKampalaToday(now),
      receivedTime: getKampalaTimeNow(now),
      receivedAt: now.toISOString(),
      recordedByUid: user.uid,
      recordedByEmail: user.email,
      recordedByName: user.displayName,
    };
    this.payments = [payment, ...this.payments];
    return { order: updated, payment };
  }

  async recordWalkInSale(
    input: WalkInSaleInput,
    user: StaffUser | null,
    idempotencyPaymentId?: string
  ): Promise<PaymentTransaction> {
    if (!user) throw new Error('Access denied');
    const errors = validateWalkInSale(input);
    const first = Object.values(errors)[0];
    if (first) throw new Error(first);
    const paymentId = idempotencyPaymentId || generatePaymentId(input.receivedDate);
    if (this.payments.some((p) => p.paymentId === paymentId)) {
      throw new Error('Duplicate sale prevented.');
    }
    const sale: PaymentTransaction = {
      paymentId,
      kind: 'walk_in',
      paymentMethod: input.paymentMethod,
      orderId: '',
      customerName: 'Walk-in Customer',
      description: input.description.trim(),
      amountUgx: Math.round(input.amountUgx),
      receivedDate: input.receivedDate,
      receivedTime: input.receivedTime,
      receivedAt: new Date().toISOString(),
      recordedByUid: user.uid,
      recordedByEmail: user.email,
      recordedByName: user.displayName,
    };
    this.payments = [sale, ...this.payments];
    return sale;
  }

  async recordCashFlowEntry(
    input: CashFlowEntryInput,
    user: StaffUser | null,
    idempotencyEntryId?: string
  ): Promise<CashFlowEntry> {
    if (!user) throw new Error('Access denied');
    const errors = validateCashFlowEntry(input);
    const first = Object.values(errors)[0];
    if (first) throw new Error(first);
    const entryId = idempotencyEntryId || generateCashFlowId(input.entryDate);
    const existing = this.cashFlowEntries.find((e) => e.entryId === entryId);
    if (existing) return existing;
    const entry: CashFlowEntry = {
      entryId,
      type: input.type,
      paymentMethod: input.paymentMethod,
      description: input.description.trim(),
      amountUgx: Math.round(input.amountUgx),
      entryDate: input.entryDate,
      entryTime: input.entryTime,
      createdAt: new Date().toISOString(),
      recordedByUid: user.uid,
      recordedByEmail: user.email,
      recordedByName: user.displayName,
    };
    this.cashFlowEntries = [entry, ...this.cashFlowEntries];
    return entry;
  }

  async deleteArchivedOrders(_orderIds: string[], user: StaffUser | null): Promise<number> {
    if (!user) throw new Error('Access denied');
    throw new Error('Order deletion is disabled until backup safeguards are enforced.');
  }
}

function makeTestOrders(): CakeOrder[] {
  const today = getKampalaToday();
  const tomorrow = addDaysToDateString(today, 1);
  const oldDate = addDaysToDateString(today, -400);

  return [
    {
      orderId: 'ORD-TEST-001',
      customerName: 'Amina Namukasa',
      customerPhone: '0772000111',
      orderDate: addDaysToDateString(today, -2),
      pickupDate: today,
      pickupTime: '14:00',
      description: 'Vanilla berry cake',
      design: 'Swirl',
      colour: 'Pink',
      icingType: 'buttercream',
      icingOtherNote: '',
      inscriptionOrDecoration: 'Happy Birthday',
      size: '8 inch',
      shape: 'Round',
      tiers: '1',
      totalPriceUgx: 200000,
      amountPaidUgx: 100000,
      balanceUgx: 100000,
      pickupStatus: 'waiting',
      createdAt: `${today}T08:00:00+03:00`,
      updatedAt: `${today}T08:00:00+03:00`,
      createdByUid: 'staff-1',
      createdByEmail: 'staff@shop.example',
      updatedByUid: 'staff-1',
      updatedByEmail: 'staff@shop.example',
    },
    {
      orderId: 'ORD-TEST-002',
      customerName: 'Daniel Okello',
      customerPhone: '+256701000222',
      orderDate: addDaysToDateString(today, -1),
      pickupDate: tomorrow,
      pickupTime: '10:00',
      description: 'Chocolate fudge cake',
      design: 'Cap topper',
      colour: 'Blue',
      icingType: 'fondant',
      icingOtherNote: '',
      inscriptionOrDecoration: 'Congrats',
      size: '10 inch',
      shape: 'Square',
      tiers: '1',
      totalPriceUgx: 180000,
      amountPaidUgx: 180000,
      balanceUgx: 0,
      pickupStatus: 'waiting',
      createdAt: `${today}T09:00:00+03:00`,
      updatedAt: `${today}T09:00:00+03:00`,
      createdByUid: 'staff-1',
      createdByEmail: 'staff@shop.example',
      updatedByUid: 'staff-1',
      updatedByEmail: 'staff@shop.example',
    },
    {
      orderId: 'ORD-TEST-OLD',
      customerName: 'Old Archive Customer',
      customerPhone: '0755000999',
      orderDate: addDaysToDateString(oldDate, -3),
      pickupDate: oldDate,
      pickupTime: '',
      description: 'Fruit cake',
      design: 'Classic',
      colour: 'Ivory',
      icingType: 'fondant',
      icingOtherNote: '',
      inscriptionOrDecoration: 'Celebration',
      size: '12 inch',
      shape: 'Round',
      tiers: '1',
      totalPriceUgx: 220000,
      amountPaidUgx: 220000,
      balanceUgx: 0,
      pickupStatus: 'picked_up',
      createdAt: `${oldDate}T10:00:00+03:00`,
      updatedAt: `${oldDate}T12:00:00+03:00`,
      createdByUid: 'owner-1',
      createdByEmail: 'owner@shop.example',
      updatedByUid: 'owner-1',
      updatedByEmail: 'owner@shop.example',
    },
  ];
}

async function completeReceipt(user: ReturnType<typeof userEvent.setup>) {
  expect(await screen.findByRole('heading', { name: /Print Receipt \(Required\)/i })).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: /^Print Receipt$/i }));
  await user.click(screen.getByRole('button', { name: /^Continue$/i }));
}

async function signInAs(user: ReturnType<typeof userEvent.setup>, email: string) {
  await user.type(screen.getByLabelText(/Staff Email/i), email);
  await user.type(screen.getByLabelText(/Password/i), 'test-password-123');
  await user.click(screen.getByRole('button', { name: /Sign In/i }));
}

vi.setConfig({ testTimeout: 15000 });

describe('Cake Order Tracker workflows & access control', () => {
  it('shows setup screen and blocks access when Firebase is not configured', async () => {
    const repo: OrderRepository = new UnconfiguredOrderRepository();
    await expect(repo.listOrders(null)).rejects.toThrow(/Firebase is not configured/i);

    render(<App repository={repo} />);
    expect(screen.getByRole('heading', { name: /Firebase Setup Required/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Demo/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /New Order/i })).not.toBeInTheDocument();
  });

  it('requires staff sign-in and has no public self-registration', async () => {
    const repo = new TestMemoryOrderRepository(makeTestOrders());
    await expect(repo.listOrders(null)).rejects.toThrow(/Access denied/i);

    render(<App repository={repo} />);
    expect(screen.getByRole('heading', { name: /Staff Sign In/i })).toBeInTheDocument();
    expect(screen.queryByText(/Amina Namukasa/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /register|sign up/i })).not.toBeInTheDocument();
  });

  it('shows two main actions (New Order & View Orders) and hides Owner Tools from staff', async () => {
    const user = userEvent.setup();
    const repo = new TestMemoryOrderRepository(makeTestOrders());
    render(<App repository={repo} />);

    await signInAs(user, 'staff@shop.example');
    expect(await screen.findByRole('button', { name: /New Order/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /View Orders/i })).toBeInTheDocument();
    expect(screen.queryByText(/Owner Tools: Archive & CSV/i)).not.toBeInTheDocument();
  });

  it('supports creating an order with visual tier builder, balance calculation and persistence on edit', async () => {
    const user = userEvent.setup();
    const repo = new TestMemoryOrderRepository(makeTestOrders());
    render(<App repository={repo} />);

    await signInAs(user, 'staff@shop.example');
    await user.click(await screen.findByRole('button', { name: /New Order/i }));

    expect(screen.getByText('1. Customer')).toBeInTheDocument();
    expect(screen.getByText('2. Cake Details')).toBeInTheDocument();
    expect(screen.getByText('3. Pickup')).toBeInTheDocument();
    expect(screen.getByText('4. Payment (UGX)')).toBeInTheDocument();

    // Design, Colour, Size, Shape and Tiers are directly visible without a collapsible dropdown
    expect(screen.getByLabelText(/^Design$/i)).toBeVisible();
    expect(screen.getByLabelText(/^Colour$/i)).toBeVisible();
    expect(screen.getByLabelText(/^Size$/i)).toBeVisible();
    expect(screen.getByLabelText(/^Shape$/i, { selector: '#cake-shape' })).toBeVisible();
    expect(screen.getByText(/Cake Tiers & Pricing/i)).toBeVisible();

    await user.type(screen.getByLabelText(/Customer Name/i), 'Grace Atwine');
    await user.type(screen.getByLabelText(/Phone Number/i), '0782555666');
    await user.type(screen.getByLabelText(/Cake Description/i), 'Red velvet cake');
    await user.type(screen.getByLabelText(/^Size$/i), '9 inch & 6 inch');

    // Tier 1: pick quick price 100,000
    const tier1QuickGroup = screen.getByRole('group', { name: /Quick prices for Tier 1/i });
    await user.click(within(tier1QuickGroup).getByRole('button', { name: '100,000' }));

    // Add Tier 2 (stacked on top): choose Square shape and custom price 50,000
    await user.click(screen.getByRole('button', { name: /\+ Add Tier/i }));
    await user.selectOptions(screen.getByLabelText('Shape', { selector: '#tier-shape-2' }), 'Square');
    const tier2PriceInput = screen.getByLabelText('Tier Price (UGX)', { selector: '#tier-price-2' });
    await user.clear(tier2PriceInput);
    await user.type(tier2PriceInput, '50000');

    // Preview shows both tiers and total UGX 150,000
    const preview = screen.getByLabelText(/Cake tier cylinder preview/i);
    expect(within(preview).getByText(/Tier 2 \(Top\) · Square/i)).toBeInTheDocument();
    expect(within(preview).getByText(/Tier 1 \(Bottom\) · Round/i)).toBeInTheDocument();
    expect(within(preview).getByText(/Cake Total \(2 tiers\)/i)).toBeInTheDocument();

    const paidInput = screen.getByLabelText(/Deposit Paid \(UGX\)/i);
    await user.clear(paidInput);
    await user.type(paidInput, '200000');

    await user.click(screen.getByRole('button', { name: /Save Order/i }));
    expect(screen.getByText(/Amount paid cannot exceed the total price/i)).toBeInTheDocument();

    await user.clear(paidInput);
    await user.type(paidInput, '50000');
    expect(screen.getAllByText(/UGX 100,000/).length).toBeGreaterThanOrEqual(1);

    await user.click(screen.getByRole('button', { name: /Save Order/i }));
    await completeReceipt(user);
    const graceHeading = await screen.findByText('Grace Atwine');
    const graceCard = graceHeading.closest('article')!;
    expect(within(graceCard).getByText(/Balance: UGX 100,000/i)).toBeInTheDocument();
    expect(within(graceCard).getByLabelText(/Cake tier illustration/i)).toBeInTheDocument();
    expect(within(graceCard).getByText(/Tier 2 \(Square\)/i)).toBeInTheDocument();
    expect(within(graceCard).getByText(/Tier 1 \(Round\)/i)).toBeInTheDocument();
    expect(within(graceCard).getByText(/9 inch & 6 inch/i)).toBeInTheDocument();

    // Reopen order and verify saved tier details and visible optional fields reappear
    await user.click(within(graceCard).getByRole('button', { name: /View or Edit Order/i }));
    expect(screen.getByLabelText(/^Design$/i)).toBeVisible();
    expect(screen.getByLabelText(/^Size$/i)).toHaveValue('9 inch & 6 inch');
    const editPreview = await screen.findByLabelText(/Cake tier cylinder preview/i);
    expect(within(editPreview).getByText(/Tier 2 \(Top\) · Square/i)).toBeInTheDocument();
    expect(within(editPreview).getByText(/Tier 1 \(Bottom\) · Round/i)).toBeInTheDocument();
  });

  it('supports searching and Today/Tomorrow date filtering from View Orders', async () => {
    const user = userEvent.setup();
    const repo = new TestMemoryOrderRepository(makeTestOrders());
    render(<App repository={repo} />);

    await signInAs(user, 'staff@shop.example');
    await user.click(await screen.findByRole('button', { name: /View Orders/i }));
    await screen.findByText('Amina Namukasa');

    await user.click(screen.getByRole('button', { name: /^Today$/i }));
    expect(screen.getByText('Amina Namukasa')).toBeInTheDocument();
    expect(screen.queryByText('Daniel Okello')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /^Tomorrow$/i }));
    expect(screen.getByText('Daniel Okello')).toBeInTheDocument();
    expect(screen.queryByText('Amina Namukasa')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /^All$/i }));
    await user.type(screen.getByLabelText(/Search Name, Phone, or Order ID/i), '0772000111');
    expect(screen.getByText('Amina Namukasa')).toBeInTheDocument();
    expect(screen.queryByText('Daniel Okello')).not.toBeInTheDocument();
  });

  it('supports View or Edit Order payment updates and confirmed pickup status toggle', async () => {
    const user = userEvent.setup();
    const repo = new TestMemoryOrderRepository(makeTestOrders());
    render(<App repository={repo} />);

    await signInAs(user, 'staff@shop.example');
    await user.click(await screen.findByRole('button', { name: /View Orders/i }));
    await screen.findByText('Amina Namukasa');

    const aminaCard = screen.getByText('Amina Namukasa').closest('article')!;
    await user.click(within(aminaCard).getByRole('button', { name: /View or Edit Order/i }));

    // Prevent overpayment
    await user.type(screen.getByLabelText(/Record Balance Payment \(UGX\)/i), '150000');
    await user.click(screen.getByRole('button', { name: /Record Payment/i }));
    expect(screen.getByText(/exceed the total price/i)).toBeInTheDocument();

    await user.clear(screen.getByLabelText(/Record Balance Payment \(UGX\)/i));
    await user.type(screen.getByLabelText(/Record Balance Payment \(UGX\)/i), '100000');
    await user.click(screen.getByRole('button', { name: /Record Payment/i }));
    expect(await screen.findByText(/Recorded payment of UGX 100,000/i)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Save Changes/i }));

    const updatedCard = (await screen.findByText('Amina Namukasa')).closest('article')!;
    expect(within(updatedCard).getByText(/Balance: UGX 0 \(Paid\)/i)).toBeInTheDocument();

    await user.click(within(updatedCard).getByRole('button', { name: /Mark Picked Up/i }));
    const dialog = screen.getByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: /Yes, Mark Picked Up/i }));

    const pickedCard = (await screen.findByText('Amina Namukasa')).closest('article')!;
    expect(within(pickedCard).getByText('Picked up')).toBeInTheDocument();
  });

  it('tracks Daily Collections (deposits, later balance payments, walk-in sales), ignores pickups, and flags historical orders', async () => {
    const user = userEvent.setup();
    const repo = new TestMemoryOrderRepository(makeTestOrders());
    render(<App repository={repo} />);

    await signInAs(user, 'staff@shop.example');

    // 1. Create a new order with a UGX 50,000 deposit today
    await user.click(await screen.findByRole('button', { name: /New Order/i }));
    await user.type(screen.getByLabelText(/Customer Name/i), 'Moses Kiggundu');
    await user.type(screen.getByLabelText(/Phone Number/i), '0772999888');
    await user.type(screen.getByLabelText(/Cake Description/i), 'Lemon sponge cake');
    const tier1Quick = screen.getByRole('group', { name: /Quick prices for Tier 1/i });
    await user.click(within(tier1Quick).getByRole('button', { name: '120,000' }));
    const paidInput = screen.getByLabelText(/Deposit Paid \(UGX\)/i);
    await user.clear(paidInput);
    await user.type(paidInput, '50000');
    await user.click(screen.getByRole('button', { name: /Save Order/i }));
    await completeReceipt(user);

    // 2. Mark Daniel Okello (fully paid historical order) as Picked up -> must NOT add to today's collections
    const danielCard = (await screen.findByText('Daniel Okello')).closest('article')!;
    await user.click(within(danielCard).getByRole('button', { name: /Mark Picked Up/i }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: /Yes, Mark Picked Up/i }));

    // 3. Go to Walk-in Sales page and record a walk-in sale of UGX 35,000
    await user.click(screen.getByRole('button', { name: /Walk-in Sales/i }));
    await user.type(screen.getByLabelText(/Cake Description/i), 'Counter cupcake box');
    await user.type(screen.getByLabelText(/Amount Received \(UGX\)/i), '35000');
    await user.click(screen.getByRole('button', { name: /Record Walk-in Sale/i }));

    // 4. Go to Daily Collections and verify walk-in sale is included once (no double counting)
    await user.click(screen.getByRole('button', { name: /Daily Collections/i }));
    expect(screen.getByText(/profit or a balance sheet/i)).toBeInTheDocument();

    const summaryGrid = screen.getByLabelText(/Daily collections summary/i);
    expect(within(summaryGrid).getByText('UGX 50,000')).toBeInTheDocument(); // Order Deposits
    expect(within(summaryGrid).getByText('UGX 35,000')).toBeInTheDocument(); // Walk-in Sales
    expect(within(summaryGrid).getAllByText('UGX 85,000')).toHaveLength(2); // Cash Collected & Total Collected

    // Spreadsheet table shows collections
    const collectionsTable = screen.getByRole('table', { name: /Itemised daily collections table/i });
    expect(within(collectionsTable).getByText('Counter cupcake box')).toBeInTheDocument();

    // Historical orders with amountPaidUgx > 0 and no payment records are flagged without inventing dates
    expect(screen.getByText(/Historical Order Amounts Needing Review/i)).toBeInTheDocument();
  });

  it('keeps Archive & CSV separate for the owner and disables deletion pending backup safeguards', async () => {
    const user = userEvent.setup();
    const repo = new TestMemoryOrderRepository(makeTestOrders());
    render(<App repository={repo} />);

    const ownerUser: StaffUser = {
      uid: 'owner-1',
      email: 'owner@shop.example',
      displayName: 'Owner',
      role: 'owner',
      active: true,
    };

    await expect(
      repo.deleteArchivedOrders(['ORD-TEST-OLD'], ownerUser)
    ).rejects.toThrow(/deletion is disabled until backup safeguards are enforced/i);

    // Retry with same paymentId is idempotent and does not double-count
    const firstPay = await repo.recordOrderPayment('ORD-TEST-001', 25000, ownerUser, 'PAY-RETRY-1');
    const retryPay = await repo.recordOrderPayment('ORD-TEST-001', 25000, ownerUser, 'PAY-RETRY-1');
    expect(firstPay.order.amountPaidUgx).toBe(125000);
    expect(retryPay.order.amountPaidUgx).toBe(125000);

    await signInAs(user, 'owner@shop.example');
    await user.click(await screen.findByRole('button', { name: /Archive & CSV/i }));

    const createObjUrl = vi.fn(() => 'blob:mock');
    const revokeObjUrl = vi.fn();
    globalThis.URL.createObjectURL = createObjUrl;
    globalThis.URL.revokeObjectURL = revokeObjUrl;

    await user.click(screen.getByRole('button', { name: /Select All \(1\)/i }));
    await user.click(screen.getByRole('button', { name: /Export Selected to CSV/i }));
    expect(createObjUrl).toHaveBeenCalledTimes(1);

    expect(screen.getByText(/Deletion Disabled Pending Backup Safeguards/i)).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /Permanently Delete Selected Archived Orders/i })
    ).not.toBeInTheDocument();
  });

  it('makes new-order retries safe after an uncertain save failure or page refresh', async () => {
    const user = userEvent.setup();
    const baseRepo = new TestMemoryOrderRepository(makeTestOrders());

    // Simulate a save that commits on server but throws an uncertain network error to the client
    let failOnce = true;
    const flakyRepo: OrderRepository = {
      configured: true,
      subscribeAuth: (cb) => baseRepo.subscribeAuth(cb),
      signIn: (e, p) => baseRepo.signIn(e, p),
      signOut: () => baseRepo.signOut(),
      listOrders: (u) => baseRepo.listOrders(u),
      getOrderById: (id, u) => baseRepo.getOrderById(id, u),
      listPayments: (u) => baseRepo.listPayments(u),
      listCashFlowEntries: (u) => baseRepo.listCashFlowEntries(u),
      updateOrder: (id, inp, u, exp) => baseRepo.updateOrder(id, inp, u, exp),
      updatePickupStatus: (id, st, u, opts) => baseRepo.updatePickupStatus(id, st, u, opts),
      deleteOrder: (id, u) => baseRepo.deleteOrder(id, u),
      recordOrderPayment: (id, amt, u, pid, pm) => baseRepo.recordOrderPayment(id, amt, u, pid, pm),
      recordWalkInSale: (inp, u, pid) => baseRepo.recordWalkInSale(inp, u, pid),
      recordCashFlowEntry: (inp, u, eid) => baseRepo.recordCashFlowEntry(inp, u, eid),
      deleteArchivedOrders: (ids, u) => baseRepo.deleteArchivedOrders(ids, u),
      async createOrder(input, staffUser, idempotency) {
        const created = await baseRepo.createOrder(input, staffUser, idempotency);
        if (failOnce) {
          failOnce = false;
          throw new Error('Network connection lost after submit');
        }
        return created;
      },
    };

    const { unmount } = render(<App repository={flakyRepo} />);
    await signInAs(user, 'staff@shop.example');
    await user.click(await screen.findByRole('button', { name: /New Order/i }));

    await user.type(screen.getByLabelText(/Customer Name/i), 'Retry Safe Customer');
    await user.type(screen.getByLabelText(/Phone Number/i), '0772111999');
    await user.type(screen.getByLabelText(/Cake Description/i), 'Chocolate sponge');
    const tier1Quick = screen.getByRole('group', { name: /Quick prices for Tier 1/i });
    await user.click(within(tier1Quick).getByRole('button', { name: '80,000' }));
    const paidInput = screen.getByLabelText(/Deposit Paid \(UGX\)/i);
    await user.clear(paidInput);
    await user.type(paidInput, '30000');

    await user.click(screen.getByRole('button', { name: /Save Order/i }));
    expect(await screen.findByText(/Network connection lost after submit/i)).toBeInTheDocument();

    // Simulate a page refresh: unmount and remount App with the same sessionStorage draft
    unmount();
    render(<App repository={flakyRepo} />);
    await user.click(await screen.findByRole('button', { name: /New Order/i }));

    // Draft is restored; retry Save Order
    expect(screen.getByLabelText(/Customer Name/i)).toHaveValue('Retry Safe Customer');
    await user.click(screen.getByRole('button', { name: /Save Order/i }));
    await completeReceipt(user);
    await screen.findByText('Retry Safe Customer');

    // Verify no duplicate order or duplicate deposit payment was created
    const staffUser: StaffUser = {
      uid: 'staff-1',
      email: 'staff@shop.example',
      displayName: 'Staff User',
      role: 'staff',
      active: true,
    };
    const allOrders = await baseRepo.listOrders(staffUser);
    const matchingOrders = allOrders.filter((o) => o.customerName === 'Retry Safe Customer');
    expect(matchingOrders).toHaveLength(1);

    const allPayments = await baseRepo.listPayments(staffUser);
    const matchingPayments = allPayments.filter(
      (p) => p.orderId === matchingOrders[0].orderId
    );
    expect(matchingPayments).toHaveLength(1);
    expect(matchingPayments[0].amountUgx).toBe(30000);
  });

  it('preserves pending ID when navigating away and warns on differences when reconciling uncertain save', async () => {
    const user = userEvent.setup();
    const baseRepo = new TestMemoryOrderRepository(makeTestOrders());

    let failOnce = true;
    const flakyRepo: OrderRepository = {
      configured: true,
      subscribeAuth: (cb) => baseRepo.subscribeAuth(cb),
      signIn: (e, p) => baseRepo.signIn(e, p),
      signOut: () => baseRepo.signOut(),
      listOrders: (u) => baseRepo.listOrders(u),
      getOrderById: (id, u) => baseRepo.getOrderById(id, u),
      listPayments: (u) => baseRepo.listPayments(u),
      listCashFlowEntries: (u) => baseRepo.listCashFlowEntries(u),
      updateOrder: (id, inp, u, exp) => baseRepo.updateOrder(id, inp, u, exp),
      updatePickupStatus: (id, st, u, opts) => baseRepo.updatePickupStatus(id, st, u, opts),
      deleteOrder: (id, u) => baseRepo.deleteOrder(id, u),
      recordOrderPayment: (id, amt, u, pid, pm) => baseRepo.recordOrderPayment(id, amt, u, pid, pm),
      recordWalkInSale: (inp, u, pid) => baseRepo.recordWalkInSale(inp, u, pid),
      recordCashFlowEntry: (inp, u, eid) => baseRepo.recordCashFlowEntry(inp, u, eid),
      deleteArchivedOrders: (ids, u) => baseRepo.deleteArchivedOrders(ids, u),
      async createOrder(input, staffUser, idempotency) {
        const created = await baseRepo.createOrder(input, staffUser, idempotency);
        if (failOnce) {
          failOnce = false;
          throw new Error('Uncertain timeout after commit');
        }
        return created;
      },
    };

    render(<App repository={flakyRepo} />);
    await signInAs(user, 'staff@shop.example');
    await user.click(await screen.findByRole('button', { name: /New Order/i }));

    await user.type(screen.getByLabelText(/Customer Name/i), 'Reconcile Customer');
    await user.type(screen.getByLabelText(/Phone Number/i), '0772888777');
    await user.type(screen.getByLabelText(/Cake Description/i), 'Original vanilla cake');
    const tier1Quick = screen.getByRole('group', { name: /Quick prices for Tier 1/i });
    await user.click(within(tier1Quick).getByRole('button', { name: '100,000' }));

    // Save commits on server, then throws uncertain timeout
    await user.click(screen.getByRole('button', { name: /Save Order/i }));
    expect(await screen.findByText(/Uncertain timeout after commit/i)).toBeInTheDocument();

    // Navigate away via Back, then return to New Order: pending ID & draft are preserved
    await user.click(screen.getByRole('button', { name: /^Back$/i }));
    await user.click((await screen.findAllByRole('button', { name: /New Order/i }))[0]);
    expect(await screen.findByText(/Resuming draft/i)).toBeInTheDocument();

    // Edit description before retrying -> reconciliation warns about difference
    const descInput = screen.getByLabelText(/Cake Description/i);
    await user.clear(descInput);
    await user.type(descInput, 'Updated vanilla berry cake');
    await user.click(screen.getByRole('button', { name: /Save Order/i }));

    expect(await screen.findByText(/was already saved on the server/i)).toBeInTheDocument();
    expect(screen.getByText(/Cake Description:/i)).toBeInTheDocument();
    expect(screen.getByText(/Original vanilla cake/i)).toBeInTheDocument();
    expect(screen.getByText('Updated vanilla berry cake', { selector: 'code' })).toBeInTheDocument();

    // Apply edits to the saved order without creating a duplicate
    await user.click(screen.getByRole('button', { name: /Update Saved Order with My Edits/i }));
    await completeReceipt(user);
    expect(await screen.findByText('Updated vanilla berry cake')).toBeInTheDocument();

    const staffUser: StaffUser = {
      uid: 'staff-1',
      email: 'staff@shop.example',
      displayName: 'Staff User',
      role: 'staff',
      active: true,
    };
    const allOrders = await baseRepo.listOrders(staffUser);
    expect(allOrders.filter((o) => o.customerName === 'Reconcile Customer')).toHaveLength(1);
  });

  it('refreshes payments after reconciling an order with deposit so Daily Collections includes it', async () => {
    const user = userEvent.setup();
    const baseRepo = new TestMemoryOrderRepository(makeTestOrders());

    let failOnce = true;
    const flakyRepo: OrderRepository = {
      configured: true,
      subscribeAuth: (cb) => baseRepo.subscribeAuth(cb),
      signIn: (e, p) => baseRepo.signIn(e, p),
      signOut: () => baseRepo.signOut(),
      listOrders: (u) => baseRepo.listOrders(u),
      getOrderById: (id, u) => baseRepo.getOrderById(id, u),
      listPayments: (u) => baseRepo.listPayments(u),
      listCashFlowEntries: (u) => baseRepo.listCashFlowEntries(u),
      updateOrder: (id, inp, u, exp) => baseRepo.updateOrder(id, inp, u, exp),
      updatePickupStatus: (id, st, u, opts) => baseRepo.updatePickupStatus(id, st, u, opts),
      deleteOrder: (id, u) => baseRepo.deleteOrder(id, u),
      recordOrderPayment: (id, amt, u, pid, pm) => baseRepo.recordOrderPayment(id, amt, u, pid, pm),
      recordWalkInSale: (inp, u, pid) => baseRepo.recordWalkInSale(inp, u, pid),
      recordCashFlowEntry: (inp, u, eid) => baseRepo.recordCashFlowEntry(inp, u, eid),
      deleteArchivedOrders: (ids, u) => baseRepo.deleteArchivedOrders(ids, u),
      async createOrder(input, staffUser, idempotency) {
        const created = await baseRepo.createOrder(input, staffUser, idempotency);
        if (failOnce) {
          failOnce = false;
          throw new Error('Uncertain network timeout');
        }
        return created;
      },
    };

    render(<App repository={flakyRepo} />);
    await signInAs(user, 'staff@shop.example');
    await user.click(await screen.findByRole('button', { name: /New Order/i }));

    await user.type(screen.getByLabelText(/Customer Name/i), 'Deposit Reconcile');
    await user.type(screen.getByLabelText(/Phone Number/i), '0772333444');
    await user.type(screen.getByLabelText(/Cake Description/i), 'Initial vanilla');
    const tier1Quick = screen.getByRole('group', { name: /Quick prices for Tier 1/i });
    await user.click(within(tier1Quick).getByRole('button', { name: '100,000' }));
    const paidInput = screen.getByLabelText(/Deposit Paid \(UGX\)/i);
    await user.clear(paidInput);
    await user.type(paidInput, '40000');

    await user.click(screen.getByRole('button', { name: /Save Order/i }));
    expect(await screen.findByText(/Uncertain network timeout/i)).toBeInTheDocument();

    const descInput = screen.getByLabelText(/Cake Description/i);
    await user.clear(descInput);
    await user.type(descInput, 'Reconciled vanilla');
    await user.click(screen.getByRole('button', { name: /Save Order/i }));
    await user.click(await screen.findByRole('button', { name: /Update Saved Order with My Edits/i }));
    await completeReceipt(user);
    await screen.findByText('Reconciled vanilla');

    // Daily Collections must include the UGX 40,000 deposit from the reconciled order
    await user.click(screen.getByRole('button', { name: /Daily Collections/i }));
    const summaryGrid = screen.getByLabelText(/Daily collections summary/i);
    expect(within(summaryGrid).getAllByText('UGX 40,000').length).toBeGreaterThanOrEqual(2);
  });

  it('detects concurrent edits on existing orders and warns before leaving unsaved edits', async () => {
    const user = userEvent.setup();
    const repo = new TestMemoryOrderRepository(makeTestOrders());
    render(<App repository={repo} />);

    await signInAs(user, 'staff@shop.example');
    await user.click(await screen.findByRole('button', { name: /View Orders/i }));

    const aminaCard = (await screen.findByText('Amina Namukasa')).closest('article')!;
    await user.click(within(aminaCard).getByRole('button', { name: /View or Edit Order/i }));

    // Simulate another staff member updating ORD-TEST-001 on the server while this form is open
    const otherStaff: StaffUser = {
      uid: 'staff-2',
      email: 'other@shop.example',
      displayName: 'Other Staff',
      role: 'staff',
      active: true,
    };
    const currentOnServer = (await repo.getOrderById('ORD-TEST-001', otherStaff))!;
    await repo.updateOrder(
      'ORD-TEST-001',
      {
        customerName: currentOnServer.customerName,
        customerPhone: currentOnServer.customerPhone,
        orderDate: currentOnServer.orderDate,
        pickupDate: currentOnServer.pickupDate,
        pickupTime: currentOnServer.pickupTime,
        description: 'Concurrent server description',
        design: currentOnServer.design,
        colour: currentOnServer.colour,
        icingType: currentOnServer.icingType,
        icingOtherNote: currentOnServer.icingOtherNote,
        inscriptionOrDecoration: currentOnServer.inscriptionOrDecoration,
        size: currentOnServer.size,
        shape: currentOnServer.shape,
        tiers: currentOnServer.tiers,
        tierDetails: currentOnServer.tierDetails,
        totalPriceUgx: currentOnServer.totalPriceUgx,
        amountPaidUgx: currentOnServer.amountPaidUgx,
      },
      otherStaff
    );

    // Local user edits description -> unsaved edit warning on Back
    const descInput = screen.getByLabelText(/Cake Description/i);
    await user.clear(descInput);
    await user.type(descInput, 'My local edit');

    await user.click(screen.getByRole('button', { name: /^Back$/i }));
    const leaveDialog = screen.getByRole('dialog');
    expect(within(leaveDialog).getByText(/Discard Unsaved Edits\?/i)).toBeInTheDocument();
    await user.click(within(leaveDialog).getByRole('button', { name: /Stay on Order/i }));
    expect(screen.getByLabelText(/Cake Description/i)).toHaveValue('My local edit');

    // Save Changes -> detects concurrent edit and asks how to resolve
    await user.click(screen.getByRole('button', { name: /Save Changes/i }));
    expect(await screen.findByText(/Concurrent edit detected on ORD-TEST-001/i)).toBeInTheDocument();
    expect(screen.getByText('Concurrent server description', { selector: 'code' })).toBeInTheDocument();
    expect(screen.getByText('My local edit', { selector: 'code' })).toBeInTheDocument();

    // Choose Reload Latest Order -> loads server version without overwriting
    await user.click(screen.getByRole('button', { name: /Reload Latest Order/i }));
    expect(screen.getByLabelText(/Cake Description/i)).toHaveValue('Concurrent server description');
  });

  it('restricts order deletion to admin, retains payment history excluded from daily totals, and tracks daily cash-flow', async () => {
    const user = userEvent.setup();
    const repo = new TestMemoryOrderRepository(makeTestOrders());
    render(<App repository={repo} />);

    // Staff cannot delete orders (neither in repo nor in UI)
    await expect(
      repo.deleteOrder('ORD-TEST-001', {
        uid: 'staff-1',
        email: 'staff@shop.example',
        displayName: 'Staff User',
        role: 'staff',
        active: true,
      })
    ).rejects.toThrow(/Only an admin can delete orders/i);

    await signInAs(user, 'staff@shop.example');
    await user.click(await screen.findByRole('button', { name: /View Orders/i }));
    await screen.findByText('Amina Namukasa');
    expect(screen.queryByRole('button', { name: /Delete Order/i })).not.toBeInTheDocument();

    // Staff records a Cash Expense (UGX 25,000) and a Mobile Money Other Item Sale (UGX 15,000) in Daily Cash-Flow
    await user.click(screen.getByRole('button', { name: /Daily Collections/i }));
    await user.type(screen.getByLabelText(/^Description \*/i), 'Cooking gas refill');
    await user.type(screen.getByLabelText(/^Amount \(UGX\) \*/i), '25000');
    await user.click(screen.getByRole('button', { name: /Record Expense/i }));

    await user.selectOptions(screen.getByLabelText(/Transaction Type/i), 'other_sale');
    await user.selectOptions(
      screen.getByLabelText(/Payment Method/i, { selector: '#cf-method' }),
      'mobile_money'
    );
    await user.type(screen.getByLabelText(/^Description \*/i), 'Birthday candles');
    await user.type(screen.getByLabelText(/^Amount \(UGX\) \*/i), '15000');
    await user.click(screen.getByRole('button', { name: /Record Other Sale/i }));

    const cashTile = screen.getByLabelText(/Cash cash-flow/i);
    expect(within(cashTile).getByText('UGX 0')).toBeInTheDocument();
    expect(within(cashTile).getByText('UGX 25,000')).toBeInTheDocument();
    expect(within(cashTile).getByText('-UGX 25,000')).toBeInTheDocument();

    const momoTile = screen.getByLabelText(/Mobile Money cash-flow/i);
    expect(within(momoTile).getByText('UGX 15,000')).toBeInTheDocument();
    expect(within(momoTile).getByText('UGX 0')).toBeInTheDocument();
    expect(within(momoTile).getByText('+UGX 15,000')).toBeInTheDocument();

    const combinedTile = screen.getByLabelText(/Combined cash-flow total/i);
    expect(within(combinedTile).getByText('UGX 15,000')).toBeInTheDocument();
    expect(within(combinedTile).getByText('UGX 25,000')).toBeInTheDocument();
    expect(within(combinedTile).getByText('-UGX 10,000')).toBeInTheDocument();
    const cfTable = screen.getByRole('table', { name: /Daily cash-flow table/i });
    expect(within(cfTable).getAllByText('Staff User')).toHaveLength(2);

    // Sign out and sign in as Owner/Admin -> create an order with deposit, then delete it
    await user.click(screen.getByRole('button', { name: /Sign out/i }));
    await signInAs(user, 'owner@shop.example');

    await user.click(await screen.findByRole('button', { name: /New Order/i }));
    await user.type(screen.getByLabelText(/Customer Name/i), 'Deleted Order Test');
    await user.type(screen.getByLabelText(/Phone Number/i), '0772777666');
    await user.type(screen.getByLabelText(/Cake Description/i), 'Chocolate cake');
    const tier1Quick = screen.getByRole('group', { name: /Quick prices for Tier 1/i });
    await user.click(within(tier1Quick).getByRole('button', { name: '100,000' }));
    const paidInput = screen.getByLabelText(/Deposit Paid \(UGX\)/i);
    await user.clear(paidInput);
    await user.type(paidInput, '60000');
    await user.click(screen.getByRole('button', { name: /Save Order/i }));
    await completeReceipt(user);

    const delCard = (await screen.findByText('Deleted Order Test')).closest('article')!;
    await user.click(within(delCard).getByRole('button', { name: /Delete Order/i }));
    await user.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: /Yes, Delete Order/i })
    );

    // Order moves to Deleted view showing who deleted it and when
    expect(screen.queryByText('Deleted Order Test')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /^Deleted$/i }));
    expect(await screen.findByText('Deleted Order Test')).toBeInTheDocument();
    expect(screen.getByText(/Deleted by/i)).toBeInTheDocument();

    // Daily Collections retains the payment record for history, but excludes UGX 60,000 from totals
    await user.click(screen.getByRole('button', { name: /Daily Collections/i }));
    const colSummary = screen.getByLabelText(/Daily collections summary/i);
    expect(within(colSummary).getAllByText('UGX 0')).toHaveLength(6);
    expect(
      screen.getByText(/Retained Payment History for Deleted Orders \(Excluded from Totals\)/i)
    ).toBeInTheDocument();
    expect(screen.getByText(/Order deleted by/i)).toBeInTheDocument();
  });
});


describe('Mandatory order receipt', () => {
  async function createOrderViaForm(user: ReturnType<typeof userEvent.setup>, name: string) {
    await user.click(await screen.findByRole('button', { name: /New Order/i }));
    await user.type(screen.getByLabelText(/Customer Name/i), name);
    await user.type(screen.getByLabelText(/Phone Number/i), '0772123123');
    await user.type(screen.getByLabelText(/Cake Description/i), 'Receipt test cake <b>bold</b>');
    const tier1Quick = screen.getByRole('group', { name: /Quick prices for Tier 1/i });
    await user.click(within(tier1Quick).getByRole('button', { name: '100,000' }));
    const paidInput = screen.getByLabelText(/Deposit Paid \(UGX\)/i);
    await user.clear(paidInput);
    await user.type(paidInput, '40000');
    await user.click(screen.getByRole('button', { name: /Save Order/i }));
  }

  it('requires printing the receipt after an order is saved, blocks navigation, and allows download', async () => {
    const user = userEvent.setup();
    const repo = new TestMemoryOrderRepository(makeTestOrders());
    render(<App repository={repo} />);
    await signInAs(user, 'staff@shop.example');
    await createOrderViaForm(user, 'Receipt Customer');

    // Required receipt screen appears with order details
    expect(
      await screen.findByRole('heading', { name: /Print Receipt \(Required\)/i })
    ).toBeInTheDocument();
    const sheet = screen.getByLabelText(/Receipt preview/i);
    expect(within(sheet).getByText('Receipt Customer')).toBeInTheDocument();
    expect(within(sheet).getByText('UGX 60,000')).toBeInTheDocument(); // balance
    expect(within(sheet).getByText(/^ORD-/)).toBeInTheDocument();

    // Continue is locked until printed; downloading alone does not unlock it
    const continueBtn = screen.getByRole('button', { name: /^Continue$/i });
    expect(continueBtn).toBeDisabled();

    const createObjUrl = vi.fn(() => 'blob:receipt');
    globalThis.URL.createObjectURL = createObjUrl;
    globalThis.URL.revokeObjectURL = vi.fn();
    await user.click(screen.getByRole('button', { name: /Download Receipt/i }));
    expect(createObjUrl).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: /^Continue$/i })).toBeDisabled();

    // Navigation is blocked while the receipt is pending
    await user.click(screen.getByRole('button', { name: /View Orders/i }));
    expect(
      screen.getByRole('heading', { name: /Print Receipt \(Required\)/i })
    ).toBeInTheDocument();
    expect(screen.getByText(/before leaving this screen/i)).toBeInTheDocument();

    // Printing unlocks Continue
    await user.click(screen.getByRole('button', { name: /^Print Receipt$/i }));
    expect(window.print).toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /^Continue$/i })).toBeEnabled();
    await user.click(screen.getByRole('button', { name: /^Continue$/i }));
    expect(await screen.findByText('Receipt Customer')).toBeInTheDocument();
  });

  it('keeps the receipt required after a page refresh and allows optional reprint from the order card', async () => {
    const user = userEvent.setup();
    const repo = new TestMemoryOrderRepository(makeTestOrders());
    const { unmount } = render(<App repository={repo} />);
    await signInAs(user, 'staff@shop.example');
    await createOrderViaForm(user, 'Refresh Customer');
    await screen.findByRole('heading', { name: /Print Receipt \(Required\)/i });

    // Simulate refresh: remount; receipt is still required
    unmount();
    render(<App repository={repo} />);
    expect(
      await screen.findByRole('heading', { name: /Print Receipt \(Required\)/i })
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /^Print Receipt$/i }));
    await user.click(screen.getByRole('button', { name: /^Continue$/i }));

    // Reprint from order card is optional (Close is enabled without printing)
    const card = (await screen.findByText('Refresh Customer')).closest('article')!;
    await user.click(within(card).getByRole('button', { name: /Print Receipt/i }));
    expect(screen.getByRole('heading', { name: /^Order Receipt$/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Close$/i })).toBeEnabled();
  });

  it('escapes customer text in the downloadable receipt HTML', () => {
    const order = { ...makeTestOrders()[0], description: '<script>alert(1)</script>', customerName: 'A & B' };
    const html = buildReceiptHtml(order, []);
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).toContain('A &amp; B');
    expect(html).toContain(order.orderId);
    expect(html).toContain('Balance due');
  });
});

describe('Pickup payments, order separation, and separate Walk-in Sales page', () => {
  it('records Kampala pickup date/time, collects outstanding balance by Mobile Money, and prevents duplicate payments', async () => {
    const user = userEvent.setup();
    const repo = new TestMemoryOrderRepository(makeTestOrders());
    render(<App repository={repo} />);

    await signInAs(user, 'staff@shop.example');
    await user.click(await screen.findByRole('button', { name: /View Orders/i }));

    // Amina Namukasa (ORD-TEST-001) has UGX 100,000 paid and UGX 100,000 balance, Waiting
    const waitingSection = await screen.findByRole('region', {
      name: /Orders waiting for pickup/i,
    });
    const aminaCard = within(waitingSection).getByText('Amina Namukasa').closest('article')!;
    await user.click(within(aminaCard).getByRole('button', { name: /Mark Picked Up/i }));

    // Modal asks for Cash or Mobile Money for the UGX 100,000 balance
    const dialog = screen.getByRole('dialog');
    await user.selectOptions(
      within(dialog).getByLabelText(/Balance Payment Method/i),
      'mobile_money'
    );
    await user.click(within(dialog).getByRole('button', { name: /Yes, Mark Picked Up/i }));

    // Order moves to Already Picked Up section with UGX 0 balance & recorded pickup timestamp
    const pickedSection = await screen.findByRole('region', {
      name: /Orders already picked up/i,
    });
    const pickedCard = within(pickedSection).getByText('Amina Namukasa').closest('article')!;
    expect(within(pickedCard).getByText(/Balance: UGX 0 \(Paid\)/i)).toBeInTheDocument();
    expect(within(pickedCard).getByText(/Picked up:/i)).toBeInTheDocument();

    // Existing picked-up order (ORD-TEST-OLD / Old Archive Customer) does NOT get an invented pickup timestamp
    const oldArchiveCard = within(pickedSection).getByText('Old Archive Customer').closest('article')!;
    expect(within(oldArchiveCard).queryByText(/Picked up:/i)).not.toBeInTheDocument();

    // Repeat attempt (Mark Waiting Again -> Mark Picked Up) must NOT create a duplicate payment
    await user.click(within(pickedCard).getByRole('button', { name: /Mark Waiting Again/i }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: /Yes, Mark Waiting/i }));

    const waitingAgain = await screen.findByRole('region', {
      name: /Orders waiting for pickup/i,
    });
    const aminaAgain = within(waitingAgain).getByText('Amina Namukasa').closest('article')!;
    await user.click(within(aminaAgain).getByRole('button', { name: /Mark Picked Up/i }));
    expect(within(screen.getByRole('dialog')).queryByLabelText(/Balance Payment Method/i)).not.toBeInTheDocument();
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: /Yes, Mark Picked Up/i }));

    // Daily Collections shows UGX 100,000 once under Later Order Payments & Mobile Money
    await user.click(screen.getByRole('button', { name: /Daily Collections/i }));
    const summaryGrid = screen.getByLabelText(/Daily collections summary/i);
    expect(within(summaryGrid).getAllByText('UGX 100,000')).toHaveLength(3);

    const collectionsTable = screen.getByRole('table', {
      name: /Itemised daily collections table/i,
    });
    const aminaRows = within(collectionsTable).getAllByText('Amina Namukasa');
    expect(aminaRows).toHaveLength(1);
    expect(within(collectionsTable).getByText('Mobile Money')).toBeInTheDocument();
  });

  it('records and displays walk-in sales on the separate Walk-in Sales page with spreadsheet table and separate method totals', async () => {
    const user = userEvent.setup();
    const repo = new TestMemoryOrderRepository(makeTestOrders());
    render(<App repository={repo} />);

    await signInAs(user, 'staff@shop.example');
    await user.click(await screen.findByRole('button', { name: /Walk-in Sales/i }));

    // Record Cash walk-in sale
    await user.type(screen.getByLabelText(/Cake Description/i), 'Chocolate bento');
    await user.type(screen.getByLabelText(/Amount Received \(UGX\)/i), '40000');
    await user.click(screen.getByRole('button', { name: /Record Walk-in Sale/i }));

    // Record Mobile Money walk-in sale
    await user.type(screen.getByLabelText(/Cake Description/i), 'Red velvet slices');
    await user.type(screen.getByLabelText(/Amount Received \(UGX\)/i), '25000');
    await user.selectOptions(screen.getByLabelText(/Payment Method/i), 'mobile_money');
    await user.click(screen.getByRole('button', { name: /Record Walk-in Sale/i }));

    const walkInTotals = screen.getByLabelText(/Walk-in sales totals/i);
    expect(within(walkInTotals).getByText('UGX 40,000')).toBeInTheDocument();
    expect(within(walkInTotals).getByText('UGX 25,000')).toBeInTheDocument();
    expect(within(walkInTotals).getByText('UGX 65,000')).toBeInTheDocument();

    const walkInTable = screen.getByRole('table', { name: /Walk-in sales table/i });
    expect(within(walkInTable).getByText('Chocolate bento')).toBeInTheDocument();
    expect(within(walkInTable).getByText('Red velvet slices')).toBeInTheDocument();

    // Daily Collections includes walk-in sales once without double counting
    await user.click(screen.getByRole('button', { name: /Daily Collections/i }));
    const summaryGrid = screen.getByLabelText(/Daily collections summary/i);
    expect(within(summaryGrid).getAllByText('UGX 65,000').length).toBeGreaterThanOrEqual(1);
  });
});
