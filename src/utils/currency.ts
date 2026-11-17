import type { CakeOrderInput, CakeTierDetail } from '../types/order';

export const QUICK_TIER_PRICES_UGX = [
  25000, 35000, 40000, 50000, 60000, 70000, 80000, 100000, 120000,
] as const;

export function calculateTiersTotalUgx(tiers: CakeTierDetail[]): number {
  return tiers.reduce(
    (sum, tier) => sum + (Number.isFinite(tier.priceUgx) ? Math.max(0, Math.round(tier.priceUgx)) : 0),
    0
  );
}

export function calculateBalanceUgx(totalPriceUgx: number, amountPaidUgx: number): number {
  const total = Number.isFinite(totalPriceUgx) ? totalPriceUgx : 0;
  const paid = Number.isFinite(amountPaidUgx) ? amountPaidUgx : 0;
  return Math.max(0, total - paid);
}

export function formatUgx(amount: number): string {
  const safe = Number.isFinite(amount) ? Math.round(amount) : 0;
  return `UGX ${new Intl.NumberFormat('en-US').format(safe)}`;
}

export type OrderValidationErrors = Partial<Record<keyof CakeOrderInput | 'general', string>>;

export function validateOrderInput(input: CakeOrderInput): OrderValidationErrors {
  const errors: OrderValidationErrors = {};

  if (!input.customerName.trim()) {
    errors.customerName = 'Customer name is required.';
  }

  if (!input.customerPhone.trim()) {
    errors.customerPhone = 'Phone contact is required.';
  } else if (input.customerPhone.trim().length < 7) {
    errors.customerPhone = 'Enter a valid phone number.';
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.orderDate)) {
    errors.orderDate = 'Order date is required.';
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.pickupDate)) {
    errors.pickupDate = 'Expected pickup date is required.';
  } else if (
    /^\d{4}-\d{2}-\d{2}$/.test(input.orderDate) &&
    input.pickupDate < input.orderDate
  ) {
    errors.pickupDate = 'Pickup date cannot be earlier than the order date.';
  }

  if (input.pickupTime && !/^\d{2}:\d{2}$/.test(input.pickupTime)) {
    errors.pickupTime = 'Pickup time must be in HH:MM format.';
  }

  if (!input.description.trim()) {
    errors.description = 'Cake description is required.';
  }

  if (input.tierDetails && input.tierDetails.length > 0) {
    const hasInvalidTier = input.tierDetails.some(
      (t) => !t.shape.trim() || !Number.isFinite(t.priceUgx) || t.priceUgx < 0
    );
    if (hasInvalidTier) {
      errors.tierDetails = 'Each tier must have a shape and a non-negative price.';
    }
  }

  if (!Number.isFinite(input.totalPriceUgx) || input.totalPriceUgx < 0) {
    errors.totalPriceUgx = 'Total price cannot be negative.';
  }

  if (!Number.isFinite(input.amountPaidUgx) || input.amountPaidUgx < 0) {
    errors.amountPaidUgx = 'Amount paid cannot be negative.';
  } else if (
    Number.isFinite(input.totalPriceUgx) &&
    input.totalPriceUgx >= 0 &&
    input.amountPaidUgx > input.totalPriceUgx
  ) {
    errors.amountPaidUgx = 'Amount paid cannot exceed the total price.';
  }

  return errors;
}
