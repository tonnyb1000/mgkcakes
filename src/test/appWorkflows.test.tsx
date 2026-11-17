import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { App } from '../App';
import {
  UnconfiguredOrderRepository,
  type OrderRepository,
} from '../services/orderRepository';
import type {
  CakeOrder,
  CakeOrderInput,
  PaymentTransaction,
  PickupStatus,
  StaffUser,
  WalkInSaleInput,
} from '../types/order';
import {
  generatePaymentId,
  validateWalkInSale,
} from '../utils/collections';
import { calculateBalanceUgx, validateOrderInput } from '../utils/currency';
import {
  addDaysToDateString,
  getKampalaTimeNow,
  getKampalaToday,
} from '../utils/dateKampala';
import { generateOrderId } from '../utils/orderId';

/**
 * Test-only in-memory repository for UI workflow verification.
 */
class TestMemoryOrderRepository implements OrderRepository {
  readonly configured = true;
  private orders: CakeOrder[];
  private payments: PaymentTransaction[];
  private currentUser: StaffUser | null = null;
  private listeners = new Set<(user: StaffUser | null, error?: string) => void>();

  constructor(initialOrders: CakeOrder[], initialPayments: PaymentTransaction[] = []) {
    this.orders = [...initialOrders];
    this.payments = [...initialPayments];
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

  async listPayments(user: StaffUser | null): Promise<PaymentTransaction[]> {
    if (!user) throw new Error('Access denied');
    return [...this.payments];
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
    user: StaffUser | null
  ): Promise<CakeOrder> {
    if (!user) throw new Error('Access denied');
    const idx = this.orders.findIndex((o) => o.orderId === orderId);
    if (idx === -1) throw new Error('Not found');
    const existing = this.orders[idx];
    const paid = existing.amountPaidUgx;
    if (input.totalPriceUgx < paid) {
      throw new Error('Total price cannot be less than the amount already paid.');
    }
    const updated: CakeOrder = {
      ...existing,
      ...input,
      amountPaidUgx: paid,
      balanceUgx: calculateBalanceUgx(input.totalPriceUgx, paid),
      updatedAt: new Date().toISOString(),
      updatedByUid: user.uid,
      updatedByEmail: user.email,
    };
    this.orders = [...this.orders.slice(0, idx), updated, ...this.orders.slice(idx + 1)];
    return updated;
  }

  async updatePickupStatus(
    orderId: string,
    status: PickupStatus,
    user: StaffUser | null
  ): Promise<CakeOrder> {
    if (!user) throw new Error('Access denied');
    const idx = this.orders.findIndex((o) => o.orderId === orderId);
    if (idx === -1) throw new Error('Not found');
    const updated: CakeOrder = {
      ...this.orders[idx],
      pickupStatus: status,
      updatedAt: new Date().toISOString(),
      updatedByUid: user.uid,
      updatedByEmail: user.email,
    };
    this.orders = [...this.orders.slice(0, idx), updated, ...this.orders.slice(idx + 1)];
    return updated;
  }

  async recordOrderPayment(
    orderId: string,
    amountUgx: number,
    user: StaffUser | null,
    idempotencyPaymentId?: string
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

async function signInAs(user: ReturnType<typeof userEvent.setup>, email: string) {
  await user.type(screen.getByLabelText(/Staff Email/i), email);
  await user.type(screen.getByLabelText(/Password/i), 'test-password-123');
  await user.click(screen.getByRole('button', { name: /Sign In/i }));
}

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

    // 2. Mark Daniel Okello (fully paid historical order) as Picked up -> must NOT add to today's collections
    const danielCard = (await screen.findByText('Daniel Okello')).closest('article')!;
    await user.click(within(danielCard).getByRole('button', { name: /Mark Picked Up/i }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: /Yes, Mark Picked Up/i }));

    // 3. Go to Daily Collections and record a walk-in sale of UGX 35,000
    await user.click(screen.getByRole('button', { name: /Daily Collections/i }));
    expect(screen.getByText(/profit or a balance sheet/i)).toBeInTheDocument();

    await user.type(screen.getByLabelText(/Cake Description/i), 'Counter cupcake box');
    await user.type(screen.getByLabelText(/Amount Received \(UGX\)/i), '35000');
    await user.click(screen.getByRole('button', { name: /Record Walk-in Sale/i }));

    const summaryGrid = screen.getByLabelText(/Daily collections summary/i);
    expect(within(summaryGrid).getByText('UGX 50,000')).toBeInTheDocument(); // Order Deposits
    expect(within(summaryGrid).getByText('UGX 35,000')).toBeInTheDocument(); // Walk-in Sales
    expect(within(summaryGrid).getByText('UGX 85,000')).toBeInTheDocument(); // Total Collected

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
      listPayments: (u) => baseRepo.listPayments(u),
      updateOrder: (id, inp, u) => baseRepo.updateOrder(id, inp, u),
      updatePickupStatus: (id, st, u) => baseRepo.updatePickupStatus(id, st, u),
      recordOrderPayment: (id, amt, u, pid) => baseRepo.recordOrderPayment(id, amt, u, pid),
      recordWalkInSale: (inp, u, pid) => baseRepo.recordWalkInSale(inp, u, pid),
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
});
