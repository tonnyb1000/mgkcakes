import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  deleteDoc,
  doc,
  getDoc,
  runTransaction,
  setDoc,
  updateDoc,
  writeBatch,
} from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

const PROJECT_ID = 'cake-order-tracker-rules-test';

let testEnv: RulesTestEnvironment;

function makeOrder(overrides: Record<string, unknown> = {}) {
  return {
    orderId: 'ORD-20261117-ABC123',
    customerName: 'Fictional Customer',
    customerPhone: '0772000111',
    orderDate: '2026-11-17',
    pickupDate: '2026-11-20',
    pickupTime: '14:00',
    description: 'Vanilla sponge cake',
    design: 'Simple swirl',
    colour: 'Blue & white',
    icingType: 'buttercream',
    icingOtherNote: '',
    inscriptionOrDecoration: 'Happy Birthday',
    size: '8 inch',
    shape: 'Round',
    tiers: '1',
    totalPriceUgx: 150000,
    amountPaidUgx: 50000,
    balanceUgx: 100000,
    lastPaymentId: 'PAY-20261117-DEP001',
    pickupStatus: 'waiting',
    createdAt: '2026-11-17T10:00:00+03:00',
    updatedAt: '2026-11-17T10:00:00+03:00',
    createdByUid: 'staff-uid',
    createdByEmail: 'staff@shop.example',
    updatedByUid: 'staff-uid',
    updatedByEmail: 'staff@shop.example',
    ...overrides,
  };
}

function makePayment(overrides: Record<string, unknown> = {}) {
  return {
    paymentId: 'PAY-20261117-DEP001',
    kind: 'order_deposit',
    orderId: 'ORD-20261117-ABC123',
    customerName: 'Fictional Customer',
    description: 'Vanilla sponge cake',
    amountUgx: 50000,
    receivedDate: '2026-11-17',
    receivedTime: '10:00',
    receivedAt: '2026-11-17T10:00:00+03:00',
    recordedByUid: 'staff-uid',
    recordedByEmail: 'staff@shop.example',
    recordedByName: 'Staff Member',
    ...overrides,
  };
}

beforeAll(async () => {
  const rules = readFileSync(resolve(process.cwd(), 'firestore.rules'), 'utf8');
  testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: {
      rules,
      host: '127.0.0.1',
      port: 8080,
    },
  });
});

beforeEach(async () => {
  await testEnv.clearFirestore();
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'staffUsers', 'owner-uid'), {
      email: 'owner@shop.example',
      displayName: 'Shop Owner',
      role: 'owner',
      active: true,
    });
    await setDoc(doc(db, 'staffUsers', 'staff-uid'), {
      email: 'staff@shop.example',
      displayName: 'Staff Member',
      role: 'staff',
      active: true,
    });
    await setDoc(doc(db, 'staffUsers', 'inactive-uid'), {
      email: 'inactive@shop.example',
      displayName: 'Former Staff',
      role: 'staff',
      active: false,
    });
    await setDoc(
      doc(db, 'orders', 'ORD-20261117-EXIST1'),
      makeOrder({
        orderId: 'ORD-20261117-EXIST1',
        lastPaymentId: 'PAY-20261117-EXIST1',
      })
    );
    await setDoc(
      doc(db, 'payments', 'PAY-20261117-EXIST1'),
      makePayment({
        paymentId: 'PAY-20261117-EXIST1',
        orderId: 'ORD-20261117-EXIST1',
      })
    );
  });
});

afterAll(async () => {
  await testEnv.cleanup();
});

describe('Firestore security rules & emulator consistency', () => {
  it('denies all unauthenticated reads and writes', async () => {
    const anonDb = testEnv.unauthenticatedContext().firestore();
    await assertFails(getDoc(doc(anonDb, 'orders', 'ORD-20261117-EXIST1')));
    await assertFails(
      setDoc(
        doc(anonDb, 'orders', 'ORD-20261117-NEW1'),
        makeOrder({ orderId: 'ORD-20261117-NEW1', amountPaidUgx: 0, balanceUgx: 150000 })
      )
    );
    await assertFails(getDoc(doc(anonDb, 'staffUsers', 'staff-uid')));
    await assertFails(getDoc(doc(anonDb, 'payments', 'PAY-20261117-EXIST1')));
  });

  it('denies signed-in users who are not active staff', async () => {
    const outsiderDb = testEnv.authenticatedContext('random-user-uid').firestore();
    await assertFails(getDoc(doc(outsiderDb, 'orders', 'ORD-20261117-EXIST1')));
    await assertFails(
      setDoc(
        doc(outsiderDb, 'orders', 'ORD-20261117-NEW2'),
        makeOrder({
          orderId: 'ORD-20261117-NEW2',
          amountPaidUgx: 0,
          balanceUgx: 150000,
          createdByUid: 'random-user-uid',
          updatedByUid: 'random-user-uid',
        })
      )
    );

    const inactiveDb = testEnv.authenticatedContext('inactive-uid').firestore();
    await assertFails(getDoc(doc(inactiveDb, 'orders', 'ORD-20261117-EXIST1')));
  });

  it('requires atomic order + deposit creation and allows zero-deposit orders', async () => {
    const staffDb = testEnv.authenticatedContext('staff-uid').firestore();

    // Order with deposit > 0 without matching payment in same batch is rejected
    await assertFails(
      setDoc(
        doc(staffDb, 'orders', 'ORD-20261117-NODEP1'),
        makeOrder({ orderId: 'ORD-20261117-NODEP1', lastPaymentId: 'PAY-MISSING' })
      )
    );

    // Zero-deposit order cannot pre-reference a future payment ID
    await assertFails(
      setDoc(
        doc(staffDb, 'orders', 'ORD-20261117-ZERO-BAD'),
        makeOrder({
          orderId: 'ORD-20261117-ZERO-BAD',
          amountPaidUgx: 0,
          balanceUgx: 150000,
          lastPaymentId: 'PAY-FUTURE-001',
        })
      )
    );

    // Order with zero deposit (no payment needed) succeeds when lastPaymentId is empty
    await assertSucceeds(
      setDoc(
        doc(staffDb, 'orders', 'ORD-20261117-ZERO01'),
        makeOrder({
          orderId: 'ORD-20261117-ZERO01',
          amountPaidUgx: 0,
          balanceUgx: 150000,
          lastPaymentId: '',
        })
      )
    );

    // Creating a payment later for that zero-deposit order without updating its balance is rejected
    await assertFails(
      setDoc(
        doc(staffDb, 'payments', 'PAY-FUTURE-001'),
        makePayment({
          paymentId: 'PAY-FUTURE-001',
          kind: 'order_balance',
          orderId: 'ORD-20261117-ZERO01',
          amountUgx: 50000,
        })
      )
    );

    // Atomic batch: order + matching deposit payment succeeds
    const batch = writeBatch(staffDb);
    batch.set(
      doc(staffDb, 'orders', 'ORD-20261117-ABC123'),
      makeOrder({
        orderId: 'ORD-20261117-ABC123',
        tierDetails: [
          { tierNumber: 1, shape: 'Round', priceUgx: 100000 },
          { tierNumber: 2, shape: 'Square', priceUgx: 50000 },
        ],
      })
    );
    batch.set(
      doc(staffDb, 'payments', 'PAY-20261117-DEP001'),
      makePayment({ paymentId: 'PAY-20261117-DEP001', orderId: 'ORD-20261117-ABC123' })
    );
    await assertSucceeds(batch.commit());
  });

  it('enforces atomic balance payment updates and rejects unbacked or orphan writes', async () => {
    const staffDb = testEnv.authenticatedContext('staff-uid').firestore();

    // Updating order details without changing amountPaidUgx succeeds
    await assertSucceeds(
      updateDoc(doc(staffDb, 'orders', 'ORD-20261117-EXIST1'), {
        pickupStatus: 'picked_up',
        updatedAt: '2026-11-17T12:00:00+03:00',
        updatedByUid: 'staff-uid',
      })
    );

    // Changing amountPaidUgx directly without a matching payment transaction fails
    await assertFails(
      updateDoc(doc(staffDb, 'orders', 'ORD-20261117-EXIST1'), {
        amountPaidUgx: 150000,
        balanceUgx: 0,
        lastPaymentId: 'PAY-FAKE-001',
        updatedAt: '2026-11-17T12:05:00+03:00',
        updatedByUid: 'staff-uid',
      })
    );

    // Creating an orphan order_balance payment without updating the order fails
    await assertFails(
      setDoc(
        doc(staffDb, 'payments', 'PAY-ORPHAN-001'),
        makePayment({
          paymentId: 'PAY-ORPHAN-001',
          kind: 'order_balance',
          orderId: 'ORD-20261117-EXIST1',
          amountUgx: 25000,
        })
      )
    );

    // Atomic transaction: create order_balance payment + update order amountPaidUgx & balanceUgx succeeds
    await assertSucceeds(
      runTransaction(staffDb, async (tx) => {
        const orderRef = doc(staffDb, 'orders', 'ORD-20261117-EXIST1');
        const payRef = doc(staffDb, 'payments', 'PAY-20261117-BAL001');
        const snap = await tx.get(orderRef);
        const existing = snap.data()!;
        const nextPaid = (existing.amountPaidUgx as number) + 40000;
        tx.set(
          payRef,
          makePayment({
            paymentId: 'PAY-20261117-BAL001',
            kind: 'order_balance',
            orderId: 'ORD-20261117-EXIST1',
            amountUgx: 40000,
          })
        );
        tx.update(orderRef, {
          amountPaidUgx: nextPaid,
          balanceUgx: (existing.totalPriceUgx as number) - nextPaid,
          lastPaymentId: 'PAY-20261117-BAL001',
          updatedAt: '2026-11-17T13:00:00+03:00',
          updatedByUid: 'staff-uid',
        });
      })
    );

    // Reusing the same lastPaymentId on a second update fails
    await assertFails(
      updateDoc(doc(staffDb, 'orders', 'ORD-20261117-EXIST1'), {
        amountPaidUgx: 130000,
        balanceUgx: 20000,
        lastPaymentId: 'PAY-20261117-BAL001',
        updatedAt: '2026-11-17T13:05:00+03:00',
        updatedByUid: 'staff-uid',
      })
    );

    // Reusing an OLDER payment ID (PAY-20261117-EXIST1) to inflate amountPaidUgx fails
    await assertFails(
      updateDoc(doc(staffDb, 'orders', 'ORD-20261117-EXIST1'), {
        amountPaidUgx: 140000,
        balanceUgx: 10000,
        lastPaymentId: 'PAY-20261117-EXIST1',
        updatedAt: '2026-11-17T13:10:00+03:00',
        updatedByUid: 'staff-uid',
      })
    );
  });

  it('keeps order paid amount consistent under concurrent order edit and payment transaction', async () => {
    const staffDb = testEnv.authenticatedContext('staff-uid').firestore();
    const ownerDb = testEnv.authenticatedContext('owner-uid').firestore();
    const staffOrderRef = doc(staffDb, 'orders', 'ORD-20261117-EXIST1');
    const ownerOrderRef = doc(ownerDb, 'orders', 'ORD-20261117-EXIST1');

    // Simulate staff recording a payment while owner concurrently edits the order
    await runTransaction(staffDb, async (tx) => {
      const snap = await tx.get(staffOrderRef);
      const existing = snap.data()!;
      const nextPaid = (existing.amountPaidUgx as number) + 30000;
      tx.set(
        doc(staffDb, 'payments', 'PAY-CONC-001'),
        makePayment({
          paymentId: 'PAY-CONC-001',
          kind: 'order_balance',
          orderId: 'ORD-20261117-EXIST1',
          amountUgx: 30000,
        })
      );
      tx.update(staffOrderRef, {
        amountPaidUgx: nextPaid,
        balanceUgx: (existing.totalPriceUgx as number) - nextPaid,
        lastPaymentId: 'PAY-CONC-001',
        updatedAt: '2026-11-17T14:00:00+03:00',
        updatedByUid: 'staff-uid',
      });
    });

    await runTransaction(ownerDb, async (tx) => {
      const snap = await tx.get(ownerOrderRef);
      const existing = snap.data()!;
      const paid = existing.amountPaidUgx as number;
      const nextTotal = 180000;
      tx.update(ownerOrderRef, {
        description: 'Updated description concurrently',
        totalPriceUgx: nextTotal,
        amountPaidUgx: paid,
        balanceUgx: nextTotal - paid,
        updatedAt: '2026-11-17T14:00:01+03:00',
        updatedByUid: 'owner-uid',
      });
    });

    const finalSnap = await getDoc(staffOrderRef);
    const finalData = finalSnap.data()!;
    expect(finalData.amountPaidUgx).toBe(80000);
    expect(finalData.totalPriceUgx).toBe(180000);
    expect(finalData.balanceUgx).toBe(100000);
    expect(finalData.description).toBe('Updated description concurrently');
  });

  it('disables order and payment deletion for both staff and owner until backup safeguards exist', async () => {
    const staffDb = testEnv.authenticatedContext('staff-uid').firestore();
    const ownerDb = testEnv.authenticatedContext('owner-uid').firestore();

    await assertFails(deleteDoc(doc(staffDb, 'orders', 'ORD-20261117-EXIST1')));
    await assertFails(deleteDoc(doc(ownerDb, 'orders', 'ORD-20261117-EXIST1')));
    await assertFails(deleteDoc(doc(staffDb, 'payments', 'PAY-20261117-EXIST1')));
    await assertFails(deleteDoc(doc(ownerDb, 'payments', 'PAY-20261117-EXIST1')));
  });

  it('allows walk-in sales and rejects negative/invalid orders and immutable payment updates', async () => {
    const staffDb = testEnv.authenticatedContext('staff-uid').firestore();

    // Valid walk-in sale succeeds
    await assertSucceeds(
      setDoc(
        doc(staffDb, 'payments', 'PAY-20261118-WALK01'),
        makePayment({
          paymentId: 'PAY-20261118-WALK01',
          kind: 'walk_in',
          orderId: '',
          customerName: 'Walk-in Customer',
          description: 'Counter slice box',
          amountUgx: 35000,
        })
      )
    );

    // Payments are immutable
    await assertFails(
      updateDoc(doc(staffDb, 'payments', 'PAY-20261118-WALK01'), { amountUgx: 99999 })
    );

    // Negative tier price rejected
    await assertFails(
      setDoc(
        doc(staffDb, 'orders', 'ORD-20261117-BAD5'),
        makeOrder({
          orderId: 'ORD-20261117-BAD5',
          amountPaidUgx: 0,
          balanceUgx: 150000,
          tierDetails: [{ tierNumber: 1, shape: 'Round', priceUgx: -1000 }],
        })
      )
    );
  });
});
