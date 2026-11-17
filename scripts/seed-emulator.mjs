const PROJECT_ID = 'cake-order-tracker-local';
const AUTH_EMULATOR = 'http://127.0.0.1:9099';
const FIRESTORE_EMULATOR = 'http://127.0.0.1:8080';

function formatKampalaDate(offsetDays = 0) {
  const now = new Date(Date.now() + offsetDays * 86400000);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Kampala',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const y = parts.find((p) => p.type === 'year').value;
  const m = parts.find((p) => p.type === 'month').value;
  const d = parts.find((p) => p.type === 'day').value;
  return `${y}-${m}-${d}`;
}

async function createOrSignInAuthUser(email, password, displayName) {
  const signUpRes = await fetch(
    `${AUTH_EMULATOR}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo-emulator-api-key`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, displayName, returnSecureToken: true }),
    }
  );
  const signUpData = await signUpRes.json();
  if (signUpRes.ok) return signUpData.localId;

  if (signUpData?.error?.message === 'EMAIL_EXISTS') {
    const signInRes = await fetch(
      `${AUTH_EMULATOR}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-emulator-api-key`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, returnSecureToken: true }),
      }
    );
    const signInData = await signInRes.json();
    if (!signInRes.ok) throw new Error(JSON.stringify(signInData));
    return signInData.localId;
  }

  throw new Error(JSON.stringify(signUpData));
}

function toFirestoreValue(v) {
  if (typeof v === 'string') return { stringValue: v };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') return { integerValue: String(Math.round(v)) };
  if (Array.isArray(v)) {
    return { arrayValue: { values: v.map((item) => toFirestoreValue(item)) } };
  }
  if (v && typeof v === 'object') {
    return { mapValue: toFirestoreFields(v) };
  }
  return { nullValue: null };
}

function toFirestoreFields(obj) {
  const fields = {};
  for (const [k, v] of Object.entries(obj)) {
    fields[k] = toFirestoreValue(v);
  }
  return { fields };
}

async function putFirestoreDoc(collection, docId, data) {
  const url = `${FIRESTORE_EMULATOR}/v1/projects/${PROJECT_ID}/databases/(default)/documents/${collection}/${docId}`;
  const res = await fetch(url, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer owner',
    },
    body: JSON.stringify(toFirestoreFields(data)),
  });
  if (!res.ok) {
    throw new Error(`Firestore seed failed for ${collection}/${docId}: ${await res.text()}`);
  }
}

async function main() {
  const staffUid = await createOrSignInAuthUser(
    'staff@shop.example',
    'StaffPass123!',
    'Fictional Staff'
  );
  const ownerUid = await createOrSignInAuthUser(
    'owner@shop.example',
    'OwnerPass123!',
    'Fictional Owner'
  );

  await putFirestoreDoc('staffUsers', staffUid, {
    email: 'staff@shop.example',
    displayName: 'Fictional Staff',
    role: 'staff',
    active: true,
  });

  await putFirestoreDoc('staffUsers', ownerUid, {
    email: 'owner@shop.example',
    displayName: 'Fictional Owner',
    role: 'owner',
    active: true,
  });

  const today = formatKampalaDate(0);
  const tomorrow = formatKampalaDate(1);
  const threeDaysAgo = formatKampalaDate(-3);
  const oldDate = formatKampalaDate(-400);

  const sampleOrders = [
    {
      orderId: 'ORD-EMU-1001',
      customerName: 'Amina Namukasa (Fictional)',
      customerPhone: '0772000101',
      orderDate: threeDaysAgo,
      pickupDate: today,
      pickupTime: '14:00',
      description: 'Vanilla sponge birthday cake with berry filling',
      design: 'Smooth finish with wafer butterflies',
      colour: 'Blue & white',
      icingType: 'buttercream',
      icingOtherNote: '',
      inscriptionOrDecoration: 'Happy Birthday Sarah',
      size: '10 inch & 8 inch',
      shape: 'Round, Square',
      tiers: '2',
      tierDetails: [
        { tierNumber: 1, shape: 'Round', priceUgx: 120000 },
        { tierNumber: 2, shape: 'Square', priceUgx: 80000 },
      ],
      totalPriceUgx: 200000,
      amountPaidUgx: 120000,
      balanceUgx: 80000,
      lastPaymentId: 'PAY-EMU-1001',
      pickupStatus: 'waiting',
      createdAt: `${threeDaysAgo}T09:15:00+03:00`,
      updatedAt: `${threeDaysAgo}T09:15:00+03:00`,
      createdByUid: staffUid,
      createdByEmail: 'staff@shop.example',
      updatedByUid: staffUid,
      updatedByEmail: 'staff@shop.example',
    },
    {
      orderId: 'ORD-EMU-1002',
      customerName: 'Daniel Okello (Fictional)',
      customerPhone: '+256701000202',
      orderDate: threeDaysAgo,
      pickupDate: tomorrow,
      pickupTime: '10:30',
      description: 'Chocolate fudge graduation cake',
      design: 'Graduation cap topper',
      colour: 'Navy & white',
      icingType: 'fondant',
      icingOtherNote: '',
      inscriptionOrDecoration: 'Congratulations Daniel',
      size: '10 inch',
      shape: 'Square',
      tiers: '1',
      totalPriceUgx: 180000,
      amountPaidUgx: 180000,
      balanceUgx: 0,
      lastPaymentId: 'PAY-EMU-1002',
      pickupStatus: 'waiting',
      createdAt: `${threeDaysAgo}T11:30:00+03:00`,
      updatedAt: `${threeDaysAgo}T11:30:00+03:00`,
      createdByUid: staffUid,
      createdByEmail: 'staff@shop.example',
      updatedByUid: staffUid,
      updatedByEmail: 'staff@shop.example',
    },
    {
      orderId: 'ORD-EMU-0901',
      customerName: 'Peter Ssemakula (Fictional Archive)',
      customerPhone: '0755000901',
      orderDate: formatKampalaDate(-405),
      pickupDate: oldDate,
      pickupTime: '16:00',
      description: 'Fruit cake for family gathering',
      design: 'Classic royal icing border',
      colour: 'Ivory',
      icingType: 'fondant',
      icingOtherNote: '',
      inscriptionOrDecoration: 'Family Reunion',
      size: '12 inch',
      shape: 'Round',
      tiers: '1',
      totalPriceUgx: 220000,
      amountPaidUgx: 220000,
      balanceUgx: 0,
      pickupStatus: 'picked_up',
      createdAt: `${oldDate}T10:00:00+03:00`,
      updatedAt: `${oldDate}T16:15:00+03:00`,
      createdByUid: ownerUid,
      createdByEmail: 'owner@shop.example',
      updatedByUid: ownerUid,
      updatedByEmail: 'owner@shop.example',
    },
  ];

  for (const order of sampleOrders) {
    await putFirestoreDoc('orders', order.orderId, order);
  }

  // Seed dated payment transactions for ORD-EMU-1001 & ORD-EMU-1002 + a walk-in sale today.
  // Leave ORD-EMU-0901 without dated payment transactions to demonstrate historical review flagging.
  const samplePayments = [
    {
      paymentId: 'PAY-EMU-1001',
      kind: 'order_deposit',
      orderId: 'ORD-EMU-1001',
      customerName: 'Amina Namukasa (Fictional)',
      description: 'Vanilla sponge birthday cake with berry filling',
      amountUgx: 120000,
      receivedDate: threeDaysAgo,
      receivedTime: '09:15',
      receivedAt: `${threeDaysAgo}T09:15:00+03:00`,
      recordedByUid: staffUid,
      recordedByEmail: 'staff@shop.example',
      recordedByName: 'Fictional Staff',
    },
    {
      paymentId: 'PAY-EMU-1002',
      kind: 'order_deposit',
      orderId: 'ORD-EMU-1002',
      customerName: 'Daniel Okello (Fictional)',
      description: 'Chocolate fudge graduation cake',
      amountUgx: 180000,
      receivedDate: threeDaysAgo,
      receivedTime: '11:30',
      receivedAt: `${threeDaysAgo}T11:30:00+03:00`,
      recordedByUid: staffUid,
      recordedByEmail: 'staff@shop.example',
      recordedByName: 'Fictional Staff',
    },
    {
      paymentId: 'PAY-EMU-WALKIN1',
      kind: 'walk_in',
      orderId: '',
      customerName: 'Walk-in Customer',
      description: 'Counter chocolate slice box (Fictional)',
      amountUgx: 45000,
      receivedDate: today,
      receivedTime: '11:00',
      receivedAt: `${today}T11:00:00+03:00`,
      recordedByUid: staffUid,
      recordedByEmail: 'staff@shop.example',
      recordedByName: 'Fictional Staff',
    },
  ];

  for (const payment of samplePayments) {
    await putFirestoreDoc('payments', payment.paymentId, payment);
  }

  console.log('Seeded Auth & Firestore emulators successfully.');
  console.log(`Staff UID: ${staffUid} (staff@shop.example / StaffPass123!)`);
  console.log(`Owner UID: ${ownerUid} (owner@shop.example / OwnerPass123!)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
