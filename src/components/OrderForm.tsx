import React, { useEffect, useMemo, useRef, useState } from 'react';
import { OrderReconcileConflictError } from '../services/orderRepository';
import type {
  CakeOrder,
  CakeOrderInput,
  CakeTierDetail,
  IcingType,
  PaymentTransaction,
} from '../types/order';
import {
  generatePaymentId,
  getUnrecordedHistoricalAmount,
} from '../utils/collections';
import {
  calculateBalanceUgx,
  calculateTiersTotalUgx,
  formatUgx,
  validateOrderInput,
  type OrderValidationErrors,
} from '../utils/currency';
import { formatDateDisplay, formatTimestampKampala, getKampalaToday } from '../utils/dateKampala';
import { generateOrderId } from '../utils/orderId';
import {
  diffOrderInputAgainstSaved,
  type OrderFieldDiff,
} from '../utils/reconcileOrder';
import { CakeTierBuilder } from './CakeTierBuilder';

export const PENDING_NEW_ORDER_STORAGE_KEY = 'cake_order_pending_new_order_v1';

interface PendingNewOrderDraft {
  orderId: string;
  paymentId: string;
  saveAttempted?: boolean;
  form: CakeOrderInput;
}

function loadPendingNewOrderDraft(): PendingNewOrderDraft | null {
  if (typeof window === 'undefined' || !window.sessionStorage) return null;
  try {
    const raw = window.sessionStorage.getItem(PENDING_NEW_ORDER_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PendingNewOrderDraft;
    if (parsed && parsed.orderId && parsed.paymentId && parsed.form) {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

function savePendingNewOrderDraft(draft: PendingNewOrderDraft): void {
  if (typeof window === 'undefined' || !window.sessionStorage) return;
  try {
    window.sessionStorage.setItem(PENDING_NEW_ORDER_STORAGE_KEY, JSON.stringify(draft));
  } catch {
    // Ignore storage quota errors
  }
}

export function clearPendingNewOrderDraft(): void {
  if (typeof window === 'undefined' || !window.sessionStorage) return;
  try {
    window.sessionStorage.removeItem(PENDING_NEW_ORDER_STORAGE_KEY);
  } catch {
    // Ignore storage errors
  }
}

interface OrderFormProps {
  existingOrder?: CakeOrder | null;
  orderPayments?: PaymentTransaction[];
  onSave: (
    input: CakeOrderInput,
    orderId?: string,
    newOrderIdempotency?: { orderId: string; paymentId: string }
  ) => Promise<void>;
  onCheckExistingOrder?: (orderId: string) => Promise<CakeOrder | null>;
  onResolveKeepSaved?: (existingOrder: CakeOrder) => void;
  onRecordPayment?: (
    orderId: string,
    amountUgx: number,
    idempotencyPaymentId: string
  ) => Promise<void>;
  onCancel?: () => void;
}

function buildInitialTiers(existing?: CakeOrder | null): CakeTierDetail[] {
  if (existing?.tierDetails && existing.tierDetails.length > 0) {
    return existing.tierDetails.map((t, idx) => ({
      tierNumber: t.tierNumber || idx + 1,
      shape: t.shape || 'Round',
      priceUgx: Number.isFinite(t.priceUgx) ? t.priceUgx : 0,
    }));
  }

  return [
    {
      tierNumber: 1,
      shape: existing?.shape?.trim() || 'Round',
      priceUgx: existing ? existing.totalPriceUgx : 0,
    },
  ];
}

function buildInitialState(existing?: CakeOrder | null): CakeOrderInput {
  const today = getKampalaToday();
  const initialTiers = buildInitialTiers(existing);
  const totalFromTiers = calculateTiersTotalUgx(initialTiers);

  if (!existing) {
    return {
      customerName: '',
      customerPhone: '',
      orderDate: today,
      pickupDate: today,
      pickupTime: '',
      description: '',
      design: '',
      colour: '',
      icingType: 'buttercream',
      icingOtherNote: '',
      inscriptionOrDecoration: '',
      size: '',
      shape: 'Round',
      tiers: '1',
      tierDetails: initialTiers,
      totalPriceUgx: totalFromTiers,
      amountPaidUgx: 0,
      pickupStatus: 'waiting',
    };
  }

  return {
    customerName: existing.customerName,
    customerPhone: existing.customerPhone,
    orderDate: existing.orderDate,
    pickupDate: existing.pickupDate,
    pickupTime: existing.pickupTime,
    description: existing.description,
    design: existing.design,
    colour: existing.colour,
    icingType: existing.icingType,
    icingOtherNote: existing.icingOtherNote ?? '',
    inscriptionOrDecoration: existing.inscriptionOrDecoration,
    size: existing.size,
    shape: existing.shape,
    tiers: existing.tiers || String(initialTiers.length),
    tierDetails: initialTiers,
    totalPriceUgx: totalFromTiers,
    amountPaidUgx: existing.amountPaidUgx,
    pickupStatus: existing.pickupStatus,
  };
}

export const OrderForm: React.FC<OrderFormProps> = ({
  existingOrder,
  orderPayments = [],
  onSave,
  onCheckExistingOrder,
  onResolveKeepSaved,
  onRecordPayment,
  onCancel,
}) => {
  const isEditing = Boolean(existingOrder);
  const initialDraft = useMemo(
    () => (isEditing ? null : loadPendingNewOrderDraft()),
    [isEditing]
  );
  const [form, setForm] = useState<CakeOrderInput>(() =>
    initialDraft ? initialDraft.form : buildInitialState(existingOrder)
  );
  const pendingNewOrderIdsRef = useRef<{ orderId: string; paymentId: string }>(
    initialDraft
      ? { orderId: initialDraft.orderId, paymentId: initialDraft.paymentId }
      : {
          orderId: generateOrderId(getKampalaToday()),
          paymentId: generatePaymentId(getKampalaToday()),
        }
  );
  const saveAttemptedRef = useRef<boolean>(Boolean(initialDraft?.saveAttempted));
  const [additionalPaymentInput, setAdditionalPaymentInput] = useState('');
  const [errors, setErrors] = useState<OrderValidationErrors>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [reconcileConflict, setReconcileConflict] = useState<{
    existingOrder: CakeOrder;
    differences: OrderFieldDiff[];
  } | null>(null);
  const [paymentMessage, setPaymentMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [recordingPayment, setRecordingPayment] = useState(false);
  const pendingPaymentIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (isEditing || !initialDraft?.saveAttempted || !onCheckExistingOrder) return;
    let cancelled = false;
    void onCheckExistingOrder(initialDraft.orderId)
      .then((found) => {
        if (cancelled || !found) return;
        const diffs = diffOrderInputAgainstSaved(found, initialDraft.form);
        setReconcileConflict({ existingOrder: found, differences: diffs });
      })
      .catch(() => {
        // Ignore transient offline check error; retry will reconcile again
      });
    return () => {
      cancelled = true;
    };
  }, [isEditing, initialDraft, onCheckExistingOrder]);

  const tierList = form.tierDetails ?? [];
  const calculatedTotal = useMemo(() => calculateTiersTotalUgx(tierList), [tierList]);
  const currentPaidUgx = existingOrder ? existingOrder.amountPaidUgx : form.amountPaidUgx;
  const liveBalance = useMemo(
    () => calculateBalanceUgx(calculatedTotal, currentPaidUgx),
    [calculatedTotal, currentPaidUgx]
  );
  const unrecordedHistoricalUgx = useMemo(
    () =>
      existingOrder ? getUnrecordedHistoricalAmount(existingOrder, orderPayments) : 0,
    [existingOrder, orderPayments]
  );

  const updateField = <K extends keyof CakeOrderInput>(key: K, value: CakeOrderInput[K]) => {
    setForm((prev) => {
      const next = { ...prev, [key]: value };
      if (!isEditing) {
        savePendingNewOrderDraft({
          orderId: pendingNewOrderIdsRef.current.orderId,
          paymentId: pendingNewOrderIdsRef.current.paymentId,
          saveAttempted: saveAttemptedRef.current,
          form: next,
        });
      }
      return next;
    });
    setErrors((prev) => {
      if (!prev[key]) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  };

  const handleTiersChange = (nextTiers: CakeTierDetail[]) => {
    const nextTotal = calculateTiersTotalUgx(nextTiers);
    const uniqueShapes = Array.from(
      new Set(nextTiers.map((t) => t.shape.trim()).filter(Boolean))
    );
    setForm((prev) => {
      const next = {
        ...prev,
        tierDetails: nextTiers,
        tiers: String(nextTiers.length),
        shape: uniqueShapes.join(', '),
        totalPriceUgx: nextTotal,
      };
      if (!isEditing) {
        savePendingNewOrderDraft({
          orderId: pendingNewOrderIdsRef.current.orderId,
          paymentId: pendingNewOrderIdsRef.current.paymentId,
          saveAttempted: saveAttemptedRef.current,
          form: next,
        });
      }
      return next;
    });
    setErrors((prev) => {
      const next = { ...prev };
      delete next.tierDetails;
      delete next.totalPriceUgx;
      return next;
    });
  };

  const handleAmountPaidChange = (raw: string) => {
    if (raw === '') {
      updateField('amountPaidUgx', 0);
      return;
    }
    const parsed = Number(raw);
    updateField('amountPaidUgx', Number.isNaN(parsed) ? 0 : parsed);
  };

  const handleApplyAdditionalPayment = async () => {
    if (!existingOrder || !onRecordPayment || recordingPayment) return;
    setPaymentMessage(null);
    const extra = Number(additionalPaymentInput);
    if (!Number.isFinite(extra) || extra <= 0) {
      setErrors((prev) => ({
        ...prev,
        amountPaidUgx: 'Enter a positive payment amount to record.',
      }));
      return;
    }
    const cleanExtra = Math.round(extra);
    if (existingOrder.amountPaidUgx + cleanExtra > calculatedTotal) {
      setErrors((prev) => ({
        ...prev,
        amountPaidUgx: 'Recording this payment would exceed the total price.',
      }));
      return;
    }

    setRecordingPayment(true);
    try {
      if (!pendingPaymentIdRef.current) {
        pendingPaymentIdRef.current = generatePaymentId(getKampalaToday());
      }
      await onRecordPayment(existingOrder.orderId, cleanExtra, pendingPaymentIdRef.current);
      pendingPaymentIdRef.current = null;
      setForm((prev) => ({
        ...prev,
        amountPaidUgx: existingOrder.amountPaidUgx + cleanExtra,
      }));
      setAdditionalPaymentInput('');
      setPaymentMessage(`Recorded payment of ${formatUgx(cleanExtra)}.`);
    } catch (err) {
      setErrors((prev) => ({
        ...prev,
        amountPaidUgx: err instanceof Error ? err.message : 'Failed to record payment.',
      }));
    } finally {
      setRecordingPayment(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving) return;
    setSubmitError(null);
    const payload: CakeOrderInput = {
      ...form,
      amountPaidUgx: currentPaidUgx,
      totalPriceUgx: calculatedTotal,
    };
    const validationErrors = validateOrderInput(payload);
    if (Object.keys(validationErrors).length > 0) {
      setErrors(validationErrors);
      return;
    }

    if (!isEditing) {
      saveAttemptedRef.current = true;
      savePendingNewOrderDraft({
        orderId: pendingNewOrderIdsRef.current.orderId,
        paymentId: pendingNewOrderIdsRef.current.paymentId,
        saveAttempted: true,
        form: payload,
      });
    }

    setSaving(true);
    try {
      // Reconcile uncertain order saves before retrying
      if (!isEditing && onCheckExistingOrder) {
        const existingOnServer = await onCheckExistingOrder(pendingNewOrderIdsRef.current.orderId);
        if (existingOnServer) {
          const diffs = diffOrderInputAgainstSaved(existingOnServer, payload);
          if (diffs.length > 0) {
            setReconcileConflict({ existingOrder: existingOnServer, differences: diffs });
            return;
          }
          clearPendingNewOrderDraft();
          if (onResolveKeepSaved) {
            onResolveKeepSaved(existingOnServer);
            return;
          }
        }
      }

      await onSave(
        payload,
        existingOrder?.orderId,
        isEditing ? undefined : pendingNewOrderIdsRef.current
      );
      if (!isEditing) {
        clearPendingNewOrderDraft();
      }
    } catch (err) {
      if (err instanceof OrderReconcileConflictError) {
        setReconcileConflict({
          existingOrder: err.existingOrder,
          differences: err.differences,
        });
      } else {
        setSubmitError(err instanceof Error ? err.message : 'Failed to save order.');
      }
    } finally {
      setSaving(false);
    }
  };

  const handleKeepSavedOrder = () => {
    if (!reconcileConflict) return;
    clearPendingNewOrderDraft();
    const saved = reconcileConflict.existingOrder;
    setReconcileConflict(null);
    if (onResolveKeepSaved) {
      onResolveKeepSaved(saved);
    }
  };

  const handleApplyDraftOverSaved = async () => {
    if (!reconcileConflict || saving) return;
    setSubmitError(null);
    const payload: CakeOrderInput = {
      ...form,
      totalPriceUgx: calculatedTotal,
    };
    setSaving(true);
    try {
      await onSave(payload, reconcileConflict.existingOrder.orderId);
      clearPendingNewOrderDraft();
      setReconcileConflict(null);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Failed to update saved order.');
    } finally {
      setSaving(false);
    }
  };

  const handleDiscardNewDraft = () => {
    clearPendingNewOrderDraft();
    saveAttemptedRef.current = false;
    pendingNewOrderIdsRef.current = {
      orderId: generateOrderId(getKampalaToday()),
      paymentId: generatePaymentId(getKampalaToday()),
    };
    setReconcileConflict(null);
    setSubmitError(null);
    setErrors({});
    setForm(buildInitialState(null));
  };

  return (
    <section className="card form-card" aria-labelledby="order-form-heading">
      <div className="form-header">
        <div>
          <h2 id="order-form-heading" className="section-title">
            {isEditing ? `Order ${existingOrder?.orderId}` : 'New Order'}
          </h2>
          {isEditing && existingOrder ? (
            <p className="muted-text">
              Created {formatTimestampKampala(existingOrder.createdAt)} by{' '}
              {existingOrder.createdByEmail} &middot; Updated{' '}
              {formatTimestampKampala(existingOrder.updatedAt)}
            </p>
          ) : (
            <p className="muted-text">An Order ID is created automatically when you save.</p>
          )}
        </div>
        {onCancel && (
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={onCancel}
          >
            Back
          </button>
        )}
      </div>

      {!isEditing && initialDraft && (
        <div className="notice notice-warning banner-dismiss" role="status">
          <span>
            Resuming draft <strong>{pendingNewOrderIdsRef.current.orderId}</strong>. Pending ID is
            preserved if you navigate away.
          </span>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={handleDiscardNewDraft}
          >
            Discard Draft
          </button>
        </div>
      )}

      {reconcileConflict && (
        <div className="notice notice-warning stack-md" role="alert">
          <div>
            <strong>
              Order {reconcileConflict.existingOrder.orderId} was already saved on the server
            </strong>
            {reconcileConflict.differences.length > 0 ? (
              <p>
                Your local draft differs from the saved order. Choose whether to keep the saved
                order or update it with your edits (the saved paid amount of{' '}
                {formatUgx(reconcileConflict.existingOrder.amountPaidUgx)} is preserved):
              </p>
            ) : (
              <p>Your draft matches the saved order. No duplicate will be created.</p>
            )}
          </div>

          {reconcileConflict.differences.length > 0 && (
            <ul className="reconcile-diff-list">
              {reconcileConflict.differences.map((d) => (
                <li key={d.field}>
                  <strong>{d.field}:</strong> Saved <code>{d.savedValue}</code> vs. Your Edit{' '}
                  <code>{d.draftValue}</code>
                </li>
              ))}
            </ul>
          )}

          <div className="header-actions">
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={handleKeepSavedOrder}
              disabled={saving}
            >
              Keep Saved Order
            </button>
            {reconcileConflict.differences.length > 0 && (
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={handleApplyDraftOverSaved}
                disabled={saving}
              >
                {saving ? 'Updating…' : 'Update Saved Order with My Edits'}
              </button>
            )}
          </div>
        </div>
      )}

      {submitError && (
        <div className="notice notice-error" role="alert">
          {submitError}
        </div>
      )}

      <form onSubmit={handleSubmit} className="stack-lg" noValidate>
        <fieldset className="form-section">
          <legend>1. Customer</legend>
          <div className="grid-2">
            <div className="field">
              <label htmlFor="customer-name">Customer Name *</label>
              <input
                id="customer-name"
                type="text"
                value={form.customerName}
                onChange={(e) => updateField('customerName', e.target.value)}
                placeholder="e.g. Sarah Kigozi"
                aria-invalid={Boolean(errors.customerName)}
                required
              />
              {errors.customerName && <span className="field-error">{errors.customerName}</span>}
            </div>

            <div className="field">
              <label htmlFor="customer-phone">Phone Number *</label>
              <input
                id="customer-phone"
                type="tel"
                value={form.customerPhone}
                onChange={(e) => updateField('customerPhone', e.target.value)}
                placeholder="e.g. 0772123456"
                aria-invalid={Boolean(errors.customerPhone)}
                required
              />
              {errors.customerPhone && <span className="field-error">{errors.customerPhone}</span>}
            </div>
          </div>
        </fieldset>

        <fieldset className="form-section">
          <legend>2. Cake Details</legend>
          <div className="field">
            <label htmlFor="cake-description">Cake Description *</label>
            <textarea
              id="cake-description"
              rows={2}
              value={form.description}
              onChange={(e) => updateField('description', e.target.value)}
              placeholder="Flavour, sponge, or filling"
              aria-invalid={Boolean(errors.description)}
              required
            />
            {errors.description && <span className="field-error">{errors.description}</span>}
          </div>

          <CakeTierBuilder
            tiers={tierList}
            onChange={handleTiersChange}
            error={errors.tierDetails}
          />

          <div className="grid-2">
            <div className="field">
              <label htmlFor="icing-type">Icing *</label>
              <select
                id="icing-type"
                value={form.icingType}
                onChange={(e) => updateField('icingType', e.target.value as IcingType)}
              >
                <option value="buttercream">Buttercream</option>
                <option value="fondant">Fondant</option>
                <option value="other">Other</option>
              </select>
            </div>

            {form.icingType === 'other' && (
              <div className="field">
                <label htmlFor="icing-other-note">Specify Other Icing</label>
                <input
                  id="icing-other-note"
                  type="text"
                  value={form.icingOtherNote ?? ''}
                  onChange={(e) => updateField('icingOtherNote', e.target.value)}
                  placeholder="e.g. Whipped cream"
                />
              </div>
            )}

            <div className="field">
              <label htmlFor="inscription">Words or Decoration on Cake</label>
              <input
                id="inscription"
                type="text"
                value={form.inscriptionOrDecoration}
                onChange={(e) => updateField('inscriptionOrDecoration', e.target.value)}
                placeholder="e.g. Happy Birthday"
              />
            </div>
          </div>

          <div className="grid-2">
            <div className="field">
              <label htmlFor="cake-design">Design</label>
              <input
                id="cake-design"
                type="text"
                value={form.design}
                onChange={(e) => updateField('design', e.target.value)}
                placeholder="e.g. Floral drip"
              />
            </div>

            <div className="field">
              <label htmlFor="cake-colour">Colour</label>
              <input
                id="cake-colour"
                type="text"
                value={form.colour}
                onChange={(e) => updateField('colour', e.target.value)}
                placeholder="e.g. White & gold"
              />
            </div>
          </div>

          <div className="grid-2">
            <div className="field">
              <label htmlFor="cake-size">Size</label>
              <input
                id="cake-size"
                type="text"
                value={form.size}
                onChange={(e) => updateField('size', e.target.value)}
                placeholder="e.g. 8 inch, 2 kg"
              />
            </div>

            <div className="field">
              <label htmlFor="cake-shape">Shape</label>
              <input
                id="cake-shape"
                type="text"
                value={form.shape}
                onChange={(e) => updateField('shape', e.target.value)}
                placeholder="e.g. Round, square"
              />
            </div>
          </div>
        </fieldset>

        <fieldset className="form-section">
          <legend>3. Pickup</legend>
          <div className="grid-3">
            <div className="field">
              <label htmlFor="pickup-date">Pickup Date *</label>
              <input
                id="pickup-date"
                type="date"
                value={form.pickupDate}
                onChange={(e) => updateField('pickupDate', e.target.value)}
                aria-invalid={Boolean(errors.pickupDate)}
                required
              />
              {errors.pickupDate && <span className="field-error">{errors.pickupDate}</span>}
            </div>

            <div className="field">
              <label htmlFor="pickup-time">Pickup Time (optional)</label>
              <input
                id="pickup-time"
                type="time"
                value={form.pickupTime}
                onChange={(e) => updateField('pickupTime', e.target.value)}
                aria-invalid={Boolean(errors.pickupTime)}
              />
              {errors.pickupTime && <span className="field-error">{errors.pickupTime}</span>}
            </div>

            <div className="field">
              <label htmlFor="order-date">Order Date *</label>
              <input
                id="order-date"
                type="date"
                value={form.orderDate}
                onChange={(e) => updateField('orderDate', e.target.value)}
                aria-invalid={Boolean(errors.orderDate)}
                required
              />
              {errors.orderDate && <span className="field-error">{errors.orderDate}</span>}
            </div>
          </div>
        </fieldset>

        <fieldset className="form-section">
          <legend>4. Payment (UGX)</legend>
          <p className="help-text">
            Cake total is calculated from the tiers above. In-shop payment record only (no online
            payments).
          </p>

          <div className="grid-3">
            <div className="field">
              <label>Cake Total (UGX)</label>
              <div className="balance-box" aria-live="polite">
                <strong>{formatUgx(calculatedTotal)}</strong>
              </div>
              {errors.totalPriceUgx && <span className="field-error">{errors.totalPriceUgx}</span>}
            </div>

            <div className="field">
              <label htmlFor="amount-paid">
                {isEditing ? 'Total Paid (UGX)' : 'Deposit Paid (UGX) *'}
              </label>
              {isEditing ? (
                <div className="balance-box" aria-live="polite">
                  <strong>{formatUgx(currentPaidUgx)}</strong>
                </div>
              ) : (
                <input
                  id="amount-paid"
                  type="number"
                  min={0}
                  step={500}
                  value={form.amountPaidUgx}
                  onChange={(e) => handleAmountPaidChange(e.target.value)}
                  aria-invalid={Boolean(errors.amountPaidUgx)}
                  required
                />
              )}
              {errors.amountPaidUgx && <span className="field-error">{errors.amountPaidUgx}</span>}
            </div>

            <div className="field">
              <label>Balance</label>
              <div
                className={`balance-box ${liveBalance === 0 && calculatedTotal > 0 ? 'paid' : ''}`}
                aria-live="polite"
              >
                <strong>{formatUgx(liveBalance)}</strong>
                {liveBalance === 0 && calculatedTotal > 0 && (
                  <span className="paid-label">Paid in full</span>
                )}
              </div>
            </div>
          </div>

          {isEditing && (
            <div className="add-payment-row stack-md">
              {paymentMessage && (
                <div className="notice notice-success" role="status">
                  {paymentMessage}
                </div>
              )}

              {unrecordedHistoricalUgx > 0 && (
                <div className="notice notice-warning" role="status">
                  <strong>Historical amount needs review:</strong>{' '}
                  {formatUgx(unrecordedHistoricalUgx)} was recorded before individual payment
                  transactions were tracked. No payment dates were invented.
                </div>
              )}

              <div className="field">
                <label htmlFor="add-payment">Record Balance Payment (UGX)</label>
                <div className="inline-input-group">
                  <input
                    id="add-payment"
                    type="number"
                    min={1}
                    step={500}
                    value={additionalPaymentInput}
                    onChange={(e) => {
                      setAdditionalPaymentInput(e.target.value);
                      pendingPaymentIdRef.current = null;
                    }}
                    placeholder="e.g. 50000"
                    disabled={recordingPayment || liveBalance === 0}
                  />
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={handleApplyAdditionalPayment}
                    disabled={recordingPayment || liveBalance === 0}
                  >
                    {recordingPayment ? 'Recording…' : 'Record Payment'}
                  </button>
                </div>
              </div>

              {orderPayments.length > 0 && (
                <div className="order-payments-history">
                  <span className="money-label">Recorded Payment Transactions</span>
                  <ul className="order-tier-list">
                    {orderPayments.map((p) => (
                      <li key={p.paymentId}>
                        <span>
                          {formatDateDisplay(p.receivedDate)} {p.receivedTime} &middot;{' '}
                          {p.kind === 'order_deposit' ? 'Deposit' : 'Balance Payment'} (
                          {p.recordedByName || p.recordedByEmail})
                        </span>
                        <strong>{formatUgx(p.amountUgx)}</strong>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </fieldset>

        <div className="form-actions">
          {onCancel && (
            <button
              type="button"
              className="btn btn-secondary"
              onClick={onCancel}
            >
              Cancel
            </button>
          )}
          <button type="submit" className="btn btn-primary" disabled={saving}>
            {saving ? 'Saving…' : isEditing ? 'Save Changes' : 'Save Order'}
          </button>
        </div>
      </form>
    </section>
  );
};
