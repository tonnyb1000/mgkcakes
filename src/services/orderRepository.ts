import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  runTransaction,
  updateDoc,
  writeBatch,
} from 'firebase/firestore';
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut as firebaseSignOut,
} from 'firebase/auth';
import type {
  CakeOrder,
  CakeOrderInput,
  PaymentTransaction,
  PickupStatus,
  StaffRole,
  StaffUser,
  WalkInSaleInput,
} from '../types/order';
import {
  generatePaymentId,
  validateWalkInSale,
} from '../utils/collections';
import { calculateBalanceUgx, validateOrderInput } from '../utils/currency';
import { getKampalaTimeNow, getKampalaToday } from '../utils/dateKampala';
import { generateOrderId } from '../utils/orderId';
import { getFirebaseServices } from './firebaseClient';

export interface OrderRepository {
  readonly configured: boolean;
  subscribeAuth(callback: (user: StaffUser | null, error?: string) => void): () => void;
  signIn(email: string, password: string): Promise<StaffUser>;
  signOut(): Promise<void>;
  listOrders(currentUser: StaffUser | null): Promise<CakeOrder[]>;
  listPayments(currentUser: StaffUser | null): Promise<PaymentTransaction[]>;
  createOrder(input: CakeOrderInput, currentUser: StaffUser | null): Promise<CakeOrder>;
  updateOrder(
    orderId: string,
    input: CakeOrderInput,
    currentUser: StaffUser | null
  ): Promise<CakeOrder>;
  updatePickupStatus(
    orderId: string,
    status: PickupStatus,
    currentUser: StaffUser | null
  ): Promise<CakeOrder>;
  recordOrderPayment(
    orderId: string,
    amountUgx: number,
    currentUser: StaffUser | null,
    idempotencyPaymentId?: string
  ): Promise<{ order: CakeOrder; payment: PaymentTransaction }>;
  recordWalkInSale(
    input: WalkInSaleInput,
    currentUser: StaffUser | null,
    idempotencyPaymentId?: string
  ): Promise<PaymentTransaction>;
  deleteArchivedOrders(orderIds: string[], currentUser: StaffUser | null): Promise<number>;
}

function assertAuthorizedStaff(user: StaffUser | null): asserts user is StaffUser {
  if (!user || !user.active || (user.role !== 'staff' && user.role !== 'owner')) {
    throw new Error('Access denied: You must be signed in as authorised staff.');
  }
}

function assertOwner(user: StaffUser | null): asserts user is StaffUser {
  assertAuthorizedStaff(user);
  if (user.role !== 'owner') {
    throw new Error('Access denied: Only the shop owner can delete archived orders.');
  }
}

function assertValidOrder(input: CakeOrderInput): void {
  const errors = validateOrderInput(input);
  const firstError = Object.values(errors)[0];
  if (firstError) {
    throw new Error(firstError);
  }
}

export class UnconfiguredOrderRepository implements OrderRepository {
  readonly configured = false;

  subscribeAuth(callback: (user: StaffUser | null, error?: string) => void): () => void {
    callback(null);
    return () => {};
  }

  async signIn(): Promise<StaffUser> {
    throw new Error('Firebase is not configured.');
  }

  async signOut(): Promise<void> {}

  async listOrders(): Promise<CakeOrder[]> {
    throw new Error('Firebase is not configured. Access is blocked.');
  }

  async listPayments(): Promise<PaymentTransaction[]> {
    throw new Error('Firebase is not configured. Access is blocked.');
  }

  async createOrder(): Promise<CakeOrder> {
    throw new Error('Firebase is not configured. Access is blocked.');
  }

  async updateOrder(): Promise<CakeOrder> {
    throw new Error('Firebase is not configured. Access is blocked.');
  }

  async updatePickupStatus(): Promise<CakeOrder> {
    throw new Error('Firebase is not configured. Access is blocked.');
  }

  async recordOrderPayment(): Promise<{ order: CakeOrder; payment: PaymentTransaction }> {
    throw new Error('Firebase is not configured. Access is blocked.');
  }

  async recordWalkInSale(): Promise<PaymentTransaction> {
    throw new Error('Firebase is not configured. Access is blocked.');
  }

  async deleteArchivedOrders(): Promise<number> {
    throw new Error('Firebase is not configured. Access is blocked.');
  }
}

export class FirestoreOrderRepository implements OrderRepository {
  readonly configured = true;

  private getServices() {
    const services = getFirebaseServices();
    if (!services) {
      throw new Error('Firebase is not configured.');
    }
    return services;
  }

  subscribeAuth(callback: (user: StaffUser | null, error?: string) => void): () => void {
    const { auth, db } = this.getServices();
    return onAuthStateChanged(auth, async (firebaseUser) => {
      if (!firebaseUser) {
        callback(null);
        return;
      }

      try {
        const staffSnap = await getDoc(doc(db, 'staffUsers', firebaseUser.uid));
        if (!staffSnap.exists()) {
          callback(
            null,
            'Your account is not listed in staffUsers. Ask the shop owner to grant access.'
          );
          return;
        }
        const data = staffSnap.data();
        if (data.active !== true || (data.role !== 'staff' && data.role !== 'owner')) {
          callback(
            null,
            'Your staff account is inactive or lacks a valid role. Contact the shop owner.'
          );
          return;
        }
        callback({
          uid: firebaseUser.uid,
          email: firebaseUser.email ?? (data.email as string) ?? '',
          displayName: (data.displayName as string) || firebaseUser.email || 'Staff Member',
          role: data.role as StaffRole,
          active: true,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Failed to verify staff permissions.';
        callback(null, msg);
      }
    });
  }

  async signIn(email: string, password: string): Promise<StaffUser> {
    const { auth, db } = this.getServices();
    const credential = await signInWithEmailAndPassword(auth, email.trim(), password);
    const staffSnap = await getDoc(doc(db, 'staffUsers', credential.user.uid));
    if (!staffSnap.exists() || staffSnap.data().active !== true) {
      await firebaseSignOut(auth);
      throw new Error(
        'This account is not authorised for staff access. Ask the shop owner to add your UID to staffUsers.'
      );
    }
    const data = staffSnap.data();
    return {
      uid: credential.user.uid,
      email: credential.user.email ?? '',
      displayName: (data.displayName as string) || credential.user.email || 'Staff Member',
      role: (data.role as StaffRole) ?? 'staff',
      active: true,
    };
  }

  async signOut(): Promise<void> {
    const { auth } = this.getServices();
    await firebaseSignOut(auth);
  }

  async listOrders(currentUser: StaffUser | null): Promise<CakeOrder[]> {
    assertAuthorizedStaff(currentUser);
    const { db } = this.getServices();
    const q = query(collection(db, 'orders'), orderBy('pickupDate', 'asc'));
    const snap = await getDocs(q);
    return snap.docs.map((d) => d.data() as CakeOrder);
  }

  async listPayments(currentUser: StaffUser | null): Promise<PaymentTransaction[]> {
    assertAuthorizedStaff(currentUser);
    const { db } = this.getServices();
    const q = query(collection(db, 'payments'), orderBy('receivedDate', 'desc'));
    const snap = await getDocs(q);
    return snap.docs.map((d) => d.data() as PaymentTransaction);
  }

  async createOrder(input: CakeOrderInput, currentUser: StaffUser | null): Promise<CakeOrder> {
    assertAuthorizedStaff(currentUser);
    assertValidOrder(input);
    const { db } = this.getServices();

    const orderId = generateOrderId(input.orderDate);
    const now = new Date();
    const nowIso = now.toISOString();
    const total = Math.round(input.totalPriceUgx);
    const paid = Math.round(input.amountPaidUgx);

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
      icingOtherNote: input.icingType === 'other' ? (input.icingOtherNote ?? '').trim() : '',
      inscriptionOrDecoration: input.inscriptionOrDecoration.trim(),
      size: input.size.trim(),
      shape: input.shape.trim(),
      tiers: input.tiers.trim(),
      ...(input.tierDetails && input.tierDetails.length > 0
        ? {
            tierDetails: input.tierDetails.map((t, idx) => ({
              tierNumber: idx + 1,
              shape: t.shape.trim(),
              priceUgx: Math.round(t.priceUgx),
            })),
          }
        : {}),
      totalPriceUgx: total,
      amountPaidUgx: paid,
      balanceUgx: calculateBalanceUgx(total, paid),
      pickupStatus: input.pickupStatus ?? 'waiting',
      createdAt: nowIso,
      updatedAt: nowIso,
      createdByUid: currentUser.uid,
      createdByEmail: currentUser.email,
      updatedByUid: currentUser.uid,
      updatedByEmail: currentUser.email,
    };

    const batch = writeBatch(db);
    batch.set(doc(db, 'orders', orderId), order);

    if (paid > 0) {
      const receivedDate = getKampalaToday(now);
      const receivedTime = getKampalaTimeNow(now);
      const paymentId = generatePaymentId(receivedDate);
      const depositTx: PaymentTransaction = {
        paymentId,
        kind: 'order_deposit',
        orderId,
        customerName: order.customerName,
        description: order.description,
        amountUgx: paid,
        receivedDate,
        receivedTime,
        receivedAt: nowIso,
        recordedByUid: currentUser.uid,
        recordedByEmail: currentUser.email,
        recordedByName: currentUser.displayName,
      };
      batch.set(doc(db, 'payments', paymentId), depositTx);
    }

    await batch.commit();
    return order;
  }

  async updateOrder(
    orderId: string,
    input: CakeOrderInput,
    currentUser: StaffUser | null
  ): Promise<CakeOrder> {
    assertAuthorizedStaff(currentUser);
    assertValidOrder(input);
    const { db } = this.getServices();

    const ref = doc(db, 'orders', orderId);
    const existingSnap = await getDoc(ref);
    if (!existingSnap.exists()) {
      throw new Error(`Order ${orderId} was not found.`);
    }
    const existing = existingSnap.data() as CakeOrder;
    const total = Math.round(input.totalPriceUgx);
    // Preserve recorded amountPaidUgx; payments must be added via recordOrderPayment.
    const paid = existing.amountPaidUgx;
    if (total < paid) {
      throw new Error('Total price cannot be less than the amount already paid.');
    }

    const updated: CakeOrder = {
      ...existing,
      customerName: input.customerName.trim(),
      customerPhone: input.customerPhone.trim(),
      orderDate: input.orderDate,
      pickupDate: input.pickupDate,
      pickupTime: input.pickupTime.trim(),
      description: input.description.trim(),
      design: input.design.trim(),
      colour: input.colour.trim(),
      icingType: input.icingType,
      icingOtherNote: input.icingType === 'other' ? (input.icingOtherNote ?? '').trim() : '',
      inscriptionOrDecoration: input.inscriptionOrDecoration.trim(),
      size: input.size.trim(),
      shape: input.shape.trim(),
      tiers: input.tiers.trim(),
      ...(input.tierDetails && input.tierDetails.length > 0
        ? {
            tierDetails: input.tierDetails.map((t, idx) => ({
              tierNumber: idx + 1,
              shape: t.shape.trim(),
              priceUgx: Math.round(t.priceUgx),
            })),
          }
        : {}),
      totalPriceUgx: total,
      amountPaidUgx: paid,
      balanceUgx: calculateBalanceUgx(total, paid),
      pickupStatus: input.pickupStatus ?? existing.pickupStatus,
      updatedAt: new Date().toISOString(),
      updatedByUid: currentUser.uid,
      updatedByEmail: currentUser.email,
    };

    await updateDoc(ref, { ...updated });
    return updated;
  }

  async updatePickupStatus(
    orderId: string,
    status: PickupStatus,
    currentUser: StaffUser | null
  ): Promise<CakeOrder> {
    assertAuthorizedStaff(currentUser);
    const { db } = this.getServices();
    const ref = doc(db, 'orders', orderId);
    const existingSnap = await getDoc(ref);
    if (!existingSnap.exists()) {
      throw new Error(`Order ${orderId} was not found.`);
    }
    const existing = existingSnap.data() as CakeOrder;
    const updatedAt = new Date().toISOString();

    await updateDoc(ref, {
      pickupStatus: status,
      updatedAt,
      updatedByUid: currentUser.uid,
      updatedByEmail: currentUser.email,
    });

    return {
      ...existing,
      pickupStatus: status,
      updatedAt,
      updatedByUid: currentUser.uid,
      updatedByEmail: currentUser.email,
    };
  }

  async recordOrderPayment(
    orderId: string,
    amountUgx: number,
    currentUser: StaffUser | null,
    idempotencyPaymentId?: string
  ): Promise<{ order: CakeOrder; payment: PaymentTransaction }> {
    assertAuthorizedStaff(currentUser);
    const cleanAmount = Math.round(amountUgx);
    if (!Number.isFinite(cleanAmount) || cleanAmount <= 0) {
      throw new Error('Payment amount must be greater than zero.');
    }

    const { db } = this.getServices();
    const now = new Date();
    const receivedDate = getKampalaToday(now);
    const receivedTime = getKampalaTimeNow(now);
    const nowIso = now.toISOString();
    const paymentId = idempotencyPaymentId || generatePaymentId(receivedDate);
    const orderRef = doc(db, 'orders', orderId);
    const paymentRef = doc(db, 'payments', paymentId);

    return runTransaction(db, async (tx) => {
      const existingPaySnap = await tx.get(paymentRef);
      if (existingPaySnap.exists()) {
        throw new Error('This payment has already been recorded (duplicate prevented).');
      }

      const orderSnap = await tx.get(orderRef);
      if (!orderSnap.exists()) {
        throw new Error(`Order ${orderId} was not found.`);
      }

      const existing = orderSnap.data() as CakeOrder;
      const nextPaid = existing.amountPaidUgx + cleanAmount;
      if (nextPaid > existing.totalPriceUgx) {
        throw new Error(
          `Payment of UGX ${cleanAmount.toLocaleString()} exceeds remaining balance of UGX ${existing.balanceUgx.toLocaleString()}.`
        );
      }

      const nextBalance = calculateBalanceUgx(existing.totalPriceUgx, nextPaid);
      const updatedOrder: CakeOrder = {
        ...existing,
        amountPaidUgx: nextPaid,
        balanceUgx: nextBalance,
        updatedAt: nowIso,
        updatedByUid: currentUser.uid,
        updatedByEmail: currentUser.email,
      };

      const payment: PaymentTransaction = {
        paymentId,
        kind: 'order_balance',
        orderId,
        customerName: existing.customerName,
        description: existing.description,
        amountUgx: cleanAmount,
        receivedDate,
        receivedTime,
        receivedAt: nowIso,
        recordedByUid: currentUser.uid,
        recordedByEmail: currentUser.email,
        recordedByName: currentUser.displayName,
      };

      tx.set(paymentRef, payment);
      tx.update(orderRef, {
        amountPaidUgx: nextPaid,
        balanceUgx: nextBalance,
        updatedAt: nowIso,
        updatedByUid: currentUser.uid,
        updatedByEmail: currentUser.email,
      });

      return { order: updatedOrder, payment };
    });
  }

  async recordWalkInSale(
    input: WalkInSaleInput,
    currentUser: StaffUser | null,
    idempotencyPaymentId?: string
  ): Promise<PaymentTransaction> {
    assertAuthorizedStaff(currentUser);
    const errors = validateWalkInSale(input);
    const firstError = Object.values(errors)[0];
    if (firstError) {
      throw new Error(firstError);
    }

    const { db } = this.getServices();
    const paymentId = idempotencyPaymentId || generatePaymentId(input.receivedDate);
    const paymentRef = doc(db, 'payments', paymentId);
    const nowIso = new Date().toISOString();

    const sale: PaymentTransaction = {
      paymentId,
      kind: 'walk_in',
      orderId: '',
      customerName: 'Walk-in Customer',
      description: input.description.trim(),
      amountUgx: Math.round(input.amountUgx),
      receivedDate: input.receivedDate,
      receivedTime: input.receivedTime,
      receivedAt: nowIso,
      recordedByUid: currentUser.uid,
      recordedByEmail: currentUser.email,
      recordedByName: currentUser.displayName,
    };

    await runTransaction(db, async (tx) => {
      const existing = await tx.get(paymentRef);
      if (existing.exists()) {
        throw new Error('This walk-in sale has already been recorded (duplicate prevented).');
      }
      tx.set(paymentRef, sale);
    });

    return sale;
  }

  async deleteArchivedOrders(orderIds: string[], currentUser: StaffUser | null): Promise<number> {
    assertOwner(currentUser);
    const { db } = this.getServices();
    if (orderIds.length === 0) return 0;

    if (orderIds.length === 1) {
      await deleteDoc(doc(db, 'orders', orderIds[0]));
      return 1;
    }

    let deleted = 0;
    for (let i = 0; i < orderIds.length; i += 450) {
      const chunk = orderIds.slice(i, i + 450);
      const batch = writeBatch(db);
      for (const id of chunk) {
        batch.delete(doc(db, 'orders', id));
      }
      await batch.commit();
      deleted += chunk.length;
    }
    return deleted;
  }
}

export function createOrderRepository(): OrderRepository {
  if (getFirebaseServices()) {
    return new FirestoreOrderRepository();
  }
  return new UnconfiguredOrderRepository();
}
