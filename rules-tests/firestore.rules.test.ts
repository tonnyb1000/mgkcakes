import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { deleteDoc, doc, getDoc, setDoc, updateDoc } from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';

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
    await setDoc(doc(db, 'orders', 'ORD-20261117-EXIST1'), makeOrder({
      orderId: 'ORD-20261117-EXIST1',
      createdByUid: 'staff-uid',
      updatedByUid: 'staff-uid',
    }));
  });
});

afterAll(async () => {
  await testEnv.cleanup();
});

describe('Firestore security rules', () => {
  it('denies all unauthenticated reads and writes', async () => {
    const anonDb = testEnv.unauthenticatedContext().firestore();
    await assertFails(getDoc(doc(anonDb, 'orders', 'ORD-20261117-EXIST1')));
    await assertFails(setDoc(doc(anonDb, 'orders', 'ORD-20261117-NEW1'), makeOrder({ orderId: 'ORD-20261117-NEW1' })));
    await assertFails(getDoc(doc(anonDb, 'staffUsers', 'staff-uid')));
  });

  it('denies signed-in users who are not active staff', async () => {
    const outsiderDb = testEnv.authenticatedContext('random-user-uid').firestore();
    await assertFails(getDoc(doc(outsiderDb, 'orders', 'ORD-20261117-EXIST1')));
    await assertFails(setDoc(doc(outsiderDb, 'orders', 'ORD-20261117-NEW2'), makeOrder({
      orderId: 'ORD-20261117-NEW2',
      createdByUid: 'random-user-uid',
      updatedByUid: 'random-user-uid',
    })));

    const inactiveDb = testEnv.authenticatedContext('inactive-uid').firestore();
    await assertFails(getDoc(doc(inactiveDb, 'orders', 'ORD-20261117-EXIST1')));
  });

  it('allows active staff to read, create, and update valid orders, but forbids deleting orders or editing staffUsers', async () => {
    const staffDb = testEnv.authenticatedContext('staff-uid').firestore();

    // Read own staffUsers doc allowed, reading others or writing denied
    await assertSucceeds(getDoc(doc(staffDb, 'staffUsers', 'staff-uid')));
    await assertFails(getDoc(doc(staffDb, 'staffUsers', 'owner-uid')));
    await assertFails(setDoc(doc(staffDb, 'staffUsers', 'staff-uid'), { role: 'owner', active: true }));

    // Read order allowed
    await assertSucceeds(getDoc(doc(staffDb, 'orders', 'ORD-20261117-EXIST1')));

    // Create valid order with tierDetails allowed
    await assertSucceeds(
      setDoc(
        doc(staffDb, 'orders', 'ORD-20261117-ABC123'),
        makeOrder({
          orderId: 'ORD-20261117-ABC123',
          tierDetails: [
            { tierNumber: 1, shape: 'Round', priceUgx: 100000 },
            { tierNumber: 2, shape: 'Square', priceUgx: 50000 },
          ],
        })
      )
    );

    // Create valid legacy-style order without tierDetails still allowed
    await assertSucceeds(
      setDoc(
        doc(staffDb, 'orders', 'ORD-20261117-LEG123'),
        makeOrder({ orderId: 'ORD-20261117-LEG123' })
      )
    );

    // Update payment & pickup status allowed
    await assertSucceeds(
      updateDoc(doc(staffDb, 'orders', 'ORD-20261117-EXIST1'), {
        amountPaidUgx: 150000,
        balanceUgx: 0,
        pickupStatus: 'picked_up',
        updatedAt: '2026-11-17T12:00:00+03:00',
        updatedByUid: 'staff-uid',
      })
    );

    // Delete order denied for staff
    await assertFails(deleteDoc(doc(staffDb, 'orders', 'ORD-20261117-EXIST1')));
  });

  it('enforces UGX payment validation and immutable audit fields on orders', async () => {
    const staffDb = testEnv.authenticatedContext('staff-uid').firestore();

    // Deposit > total rejected
    await assertFails(
      setDoc(
        doc(staffDb, 'orders', 'ORD-20261117-BAD1'),
        makeOrder({
          orderId: 'ORD-20261117-BAD1',
          totalPriceUgx: 100000,
          amountPaidUgx: 120000,
          balanceUgx: 0,
        })
      )
    );

    // Negative price rejected
    await assertFails(
      setDoc(
        doc(staffDb, 'orders', 'ORD-20261117-BAD2'),
        makeOrder({
          orderId: 'ORD-20261117-BAD2',
          totalPriceUgx: -5000,
          amountPaidUgx: 0,
          balanceUgx: -5000,
        })
      )
    );

    // Mismatched balance rejected
    await assertFails(
      setDoc(
        doc(staffDb, 'orders', 'ORD-20261117-BAD3'),
        makeOrder({
          orderId: 'ORD-20261117-BAD3',
          totalPriceUgx: 100000,
          amountPaidUgx: 40000,
          balanceUgx: 50000,
        })
      )
    );

    // Spoofing createdByUid on create rejected
    await assertFails(
      setDoc(
        doc(staffDb, 'orders', 'ORD-20261117-BAD4'),
        makeOrder({
          orderId: 'ORD-20261117-BAD4',
          createdByUid: 'owner-uid',
        })
      )
    );

    // Invalid tierDetails (negative tier price) rejected
    await assertFails(
      setDoc(
        doc(staffDb, 'orders', 'ORD-20261117-BAD5'),
        makeOrder({
          orderId: 'ORD-20261117-BAD5',
          tierDetails: [{ tierNumber: 1, shape: 'Round', priceUgx: -1000 }],
        })
      )
    );
  });

  it('allows owner to manage staffUsers and delete archived orders', async () => {
    const ownerDb = testEnv.authenticatedContext('owner-uid').firestore();

    await assertSucceeds(
      setDoc(doc(ownerDb, 'staffUsers', 'new-staff-uid'), {
        email: 'newstaff@shop.example',
        displayName: 'New Staff',
        role: 'staff',
        active: true,
      })
    );

    await assertSucceeds(deleteDoc(doc(ownerDb, 'orders', 'ORD-20261117-EXIST1')));
  });

  it('enforces payment transaction rules for deposits, balance payments, and walk-in sales', async () => {
    const anonDb = testEnv.unauthenticatedContext().firestore();
    const staffDb = testEnv.authenticatedContext('staff-uid').firestore();
    const ownerDb = testEnv.authenticatedContext('owner-uid').firestore();

    const validWalkIn = {
      paymentId: 'PAY-20261118-WALK01',
      kind: 'walk_in',
      orderId: '',
      customerName: 'Walk-in Customer',
      description: 'Counter slice box',
      amountUgx: 35000,
      receivedDate: '2026-11-18',
      receivedTime: '11:30',
      receivedAt: '2026-11-18T11:30:00+03:00',
      recordedByUid: 'staff-uid',
      recordedByEmail: 'staff@shop.example',
      recordedByName: 'Staff Member',
    };

    // Unauthenticated denied
    await assertFails(setDoc(doc(anonDb, 'payments', 'PAY-20261118-WALK01'), validWalkIn));

    // Active staff can create valid walk_in and order_balance payments
    await assertSucceeds(setDoc(doc(staffDb, 'payments', 'PAY-20261118-WALK01'), validWalkIn));
    await assertSucceeds(
      setDoc(doc(staffDb, 'payments', 'PAY-20261118-BAL001'), {
        ...validWalkIn,
        paymentId: 'PAY-20261118-BAL001',
        kind: 'order_balance',
        orderId: 'ORD-20261117-EXIST1',
      })
    );

    // Rejects zero/negative amount or order_balance without orderId
    await assertFails(
      setDoc(doc(staffDb, 'payments', 'PAY-20261118-BAD001'), {
        ...validWalkIn,
        paymentId: 'PAY-20261118-BAD001',
        amountUgx: 0,
      })
    );
    await assertFails(
      setDoc(doc(staffDb, 'payments', 'PAY-20261118-BAD002'), {
        ...validWalkIn,
        paymentId: 'PAY-20261118-BAD002',
        kind: 'order_balance',
        orderId: '',
      })
    );

    // Payments are immutable (update denied) and staff cannot delete; owner can delete
    await assertFails(
      updateDoc(doc(staffDb, 'payments', 'PAY-20261118-WALK01'), { amountUgx: 99999 })
    );
    await assertFails(deleteDoc(doc(staffDb, 'payments', 'PAY-20261118-WALK01')));
    await assertSucceeds(deleteDoc(doc(ownerDb, 'payments', 'PAY-20261118-WALK01')));
  });
});
