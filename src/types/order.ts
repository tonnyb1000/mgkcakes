export type IcingType = 'buttercream' | 'fondant' | 'other';

export type PickupStatus = 'waiting' | 'picked_up';

export type StaffRole = 'staff' | 'owner';

export type PaymentKind = 'order_deposit' | 'order_balance' | 'walk_in';

export interface PaymentTransaction {
  paymentId: string;
  kind: PaymentKind;
  orderId: string; // ORD-... for order payments, '' for walk_in
  customerName: string;
  description: string;
  amountUgx: number;
  receivedDate: string; // YYYY-MM-DD in Africa/Kampala
  receivedTime: string; // HH:mm in Africa/Kampala
  receivedAt: string; // ISO 8601 timestamp
  recordedByUid: string;
  recordedByEmail: string;
  recordedByName: string;
}

export interface WalkInSaleInput {
  description: string;
  amountUgx: number;
  receivedDate: string;
  receivedTime: string;
}

export interface StaffUser {
  uid: string;
  email: string;
  displayName: string;
  role: StaffRole;
  active: boolean;
}

export interface CakeTierDetail {
  tierNumber: number; // 1 = bottom (largest), increasing upwards (smaller)
  shape: string;
  priceUgx: number;
}

export interface CakeOrder {
  orderId: string;
  customerName: string;
  customerPhone: string;
  orderDate: string; // YYYY-MM-DD in Africa/Kampala
  pickupDate: string; // YYYY-MM-DD in Africa/Kampala
  pickupTime: string; // HH:mm or empty string
  description: string;
  design: string;
  colour: string;
  icingType: IcingType;
  icingOtherNote?: string;
  inscriptionOrDecoration: string;
  size: string;
  shape: string;
  tiers: string;
  tierDetails?: CakeTierDetail[];
  totalPriceUgx: number;
  amountPaidUgx: number;
  balanceUgx: number;
  lastPaymentId?: string;
  pickupStatus: PickupStatus;
  createdAt: string; // ISO 8601 timestamp
  updatedAt: string; // ISO 8601 timestamp
  createdByUid: string;
  createdByEmail: string;
  updatedByUid: string;
  updatedByEmail: string;
}

export interface CakeOrderInput {
  customerName: string;
  customerPhone: string;
  orderDate: string;
  pickupDate: string;
  pickupTime: string;
  description: string;
  design: string;
  colour: string;
  icingType: IcingType;
  icingOtherNote?: string;
  inscriptionOrDecoration: string;
  size: string;
  shape: string;
  tiers: string;
  tierDetails?: CakeTierDetail[];
  totalPriceUgx: number;
  amountPaidUgx: number;
  pickupStatus?: PickupStatus;
}
