import React, { useMemo, useState } from 'react';
import type {
  CakeOrder,
  PaymentTransaction,
  StaffUser,
  WalkInSaleInput,
} from '../types/order';
import {
  generatePaymentId,
  getUnrecordedHistoricalAmount,
  summarizeDailyCollections,
  validateWalkInSale,
  type WalkInValidationErrors,
} from '../utils/collections';
import { formatUgx } from '../utils/currency';
import {
  addDaysToDateString,
  formatDateDisplay,
  getKampalaTimeNow,
  getKampalaToday,
} from '../utils/dateKampala';

interface SalesCollectionsPageProps {
  orders: CakeOrder[];
  payments: PaymentTransaction[];
  user: StaffUser;
  loading: boolean;
  error: string | null;
  onRefresh: () => void;
  onRecordWalkInSale: (
    input: WalkInSaleInput,
    idempotencyPaymentId: string
  ) => Promise<void>;
}

function getPaymentKindLabel(kind: PaymentTransaction['kind']): string {
  if (kind === 'order_deposit') return 'Order Deposit';
  if (kind === 'order_balance') return 'Later Order Payment';
  return 'Walk-in Sale';
}

export const SalesCollectionsPage: React.FC<SalesCollectionsPageProps> = ({
  orders,
  payments,
  user,
  loading,
  error,
  onRefresh,
  onRecordWalkInSale,
}) => {
  const todayKampala = getKampalaToday();
  const yesterdayKampala = addDaysToDateString(todayKampala, -1);

  const [selectedDate, setSelectedDate] = useState(todayKampala);
  const [description, setDescription] = useState('');
  const [amountRaw, setAmountRaw] = useState('');
  const [saleDate, setSaleDate] = useState(todayKampala);
  const [saleTime, setSaleTime] = useState(() => getKampalaTimeNow());
  const [formErrors, setFormErrors] = useState<WalkInValidationErrors>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const summary = useMemo(
    () => summarizeDailyCollections(payments, selectedDate),
    [payments, selectedDate]
  );

  const historicalReviewOrders = useMemo(
    () =>
      orders
        .map((order) => ({
          order,
          unrecordedUgx: getUnrecordedHistoricalAmount(order, payments),
        }))
        .filter((entry) => entry.unrecordedUgx > 0),
    [orders, payments]
  );

  const handleWalkInSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving) return;

    setSubmitError(null);
    const amountUgx = amountRaw === '' ? 0 : Number(amountRaw);
    const input: WalkInSaleInput = {
      description,
      amountUgx: Number.isNaN(amountUgx) ? 0 : amountUgx,
      receivedDate: saleDate,
      receivedTime: saleTime,
    };

    const validation = validateWalkInSale(input);
    if (Object.keys(validation).length > 0) {
      setFormErrors(validation);
      return;
    }

    setSaving(true);
    try {
      const paymentId = generatePaymentId(saleDate);
      await onRecordWalkInSale(input, paymentId);
      setDescription('');
      setAmountRaw('');
      setFormErrors({});
      setSelectedDate(saleDate);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Failed to record walk-in sale.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="stack-md" aria-labelledby="collections-heading">
      <div className="card">
        <div className="orders-header-row">
          <div>
            <h2 id="collections-heading" className="section-title">
              Daily Collections
            </h2>
            <p className="muted-text">
              Money received on the selected date (Africa/Kampala). Expenses are not included yet,
              so this is <strong>not</strong> profit or a balance sheet.
            </p>
          </div>
          <button type="button" className="btn btn-secondary btn-sm" onClick={onRefresh}>
            Refresh
          </button>
        </div>

        <div className="collections-date-bar">
          <div className="quick-chips" role="group" aria-label="Quick collection dates">
            <button
              type="button"
              className={`chip ${selectedDate === todayKampala ? 'active' : ''}`}
              onClick={() => setSelectedDate(todayKampala)}
            >
              Today ({formatDateDisplay(todayKampala)})
            </button>
            <button
              type="button"
              className={`chip ${selectedDate === yesterdayKampala ? 'active' : ''}`}
              onClick={() => setSelectedDate(yesterdayKampala)}
            >
              Yesterday
            </button>
          </div>

          <div className="field collections-date-input">
            <label htmlFor="collections-date">Select Date</label>
            <input
              id="collections-date"
              type="date"
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
            />
          </div>
        </div>

        {loading && (
          <div className="state-card" role="status">
            Loading collections…
          </div>
        )}

        {!loading && error && (
          <div className="notice notice-error" role="alert">
            {error}
          </div>
        )}

        {!loading && !error && (
          <div className="collections-summary-grid" aria-label="Daily collections summary">
            <div className="summary-tile">
              <span className="money-label">Order Deposits</span>
              <strong className="summary-value">{formatUgx(summary.orderDepositsUgx)}</strong>
            </div>
            <div className="summary-tile">
              <span className="money-label">Later Order Payments</span>
              <strong className="summary-value">{formatUgx(summary.laterOrderPaymentsUgx)}</strong>
            </div>
            <div className="summary-tile">
              <span className="money-label">Walk-in Sales</span>
              <strong className="summary-value">{formatUgx(summary.walkInSalesUgx)}</strong>
            </div>
            <div className="summary-tile summary-tile-total">
              <span className="money-label">Total Collected</span>
              <strong className="summary-value">{formatUgx(summary.totalCollectedUgx)}</strong>
            </div>
          </div>
        )}
      </div>

      <div className="card">
        <h3 className="section-title">Record Walk-in Sale</h3>
        <p className="muted-text">
          For cakes sold without an existing order. Recorded under staff member:{' '}
          <strong>{user.displayName}</strong>.
        </p>

        {submitError && (
          <div className="notice notice-error" role="alert">
            {submitError}
          </div>
        )}

        <form onSubmit={handleWalkInSubmit} className="stack-md" noValidate>
          <div className="grid-2">
            <div className="field">
              <label htmlFor="walkin-desc">Cake Description *</label>
              <input
                id="walkin-desc"
                type="text"
                value={description}
                onChange={(e) => {
                  setDescription(e.target.value);
                  setFormErrors((prev) => ({ ...prev, description: undefined }));
                }}
                placeholder="e.g. Vanilla slice box or counter cake"
                aria-invalid={Boolean(formErrors.description)}
                required
              />
              {formErrors.description && (
                <span className="field-error">{formErrors.description}</span>
              )}
            </div>

            <div className="field">
              <label htmlFor="walkin-amount">Amount Received (UGX) *</label>
              <input
                id="walkin-amount"
                type="number"
                min={1}
                step={500}
                value={amountRaw}
                onChange={(e) => {
                  setAmountRaw(e.target.value);
                  setFormErrors((prev) => ({ ...prev, amountUgx: undefined }));
                }}
                placeholder="e.g. 35000"
                aria-invalid={Boolean(formErrors.amountUgx)}
                required
              />
              {formErrors.amountUgx && (
                <span className="field-error">{formErrors.amountUgx}</span>
              )}
            </div>
          </div>

          <div className="grid-2">
            <div className="field">
              <label htmlFor="walkin-date">Date *</label>
              <input
                id="walkin-date"
                type="date"
                value={saleDate}
                onChange={(e) => setSaleDate(e.target.value)}
                required
              />
              {formErrors.receivedDate && (
                <span className="field-error">{formErrors.receivedDate}</span>
              )}
            </div>

            <div className="field">
              <label htmlFor="walkin-time">Time *</label>
              <input
                id="walkin-time"
                type="time"
                value={saleTime}
                onChange={(e) => setSaleTime(e.target.value)}
                required
              />
              {formErrors.receivedTime && (
                <span className="field-error">{formErrors.receivedTime}</span>
              )}
            </div>
          </div>

          <div className="form-actions">
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? 'Recording…' : 'Record Walk-in Sale'}
            </button>
          </div>
        </form>
      </div>

      <div className="card">
        <h3 className="section-title">
          Itemised Collections for {formatDateDisplay(selectedDate)}
        </h3>

        {summary.items.length === 0 ? (
          <div className="state-card">
            <p className="muted-text">
              No payments or walk-in sales recorded on {formatDateDisplay(selectedDate)}.
            </p>
          </div>
        ) : (
          <div className="collections-list">
            {summary.items.map((item) => (
              <div key={item.paymentId} className="collection-row">
                <div className="collection-row-main">
                  <div className="collection-row-top">
                    <span className={`kind-badge kind-${item.kind}`}>
                      {getPaymentKindLabel(item.kind)}
                    </span>
                    <span className="collection-time">{item.receivedTime}</span>
                    {item.orderId ? (
                      <span className="order-id-badge">{item.orderId}</span>
                    ) : (
                      <span className="order-id-badge">Walk-in</span>
                    )}
                  </div>
                  <div className="collection-row-desc">
                    <strong>
                      {item.orderId ? item.customerName : 'Walk-in Sale'}
                    </strong>{' '}
                    &middot; {item.description}
                  </div>
                  <div className="collection-row-staff">
                    Recorded by {item.recordedByName || item.recordedByEmail} ({item.paymentId})
                  </div>
                </div>
                <strong className="collection-amount">{formatUgx(item.amountUgx)}</strong>
              </div>
            ))}
          </div>
        )}
      </div>

      {historicalReviewOrders.length > 0 && (
        <div className="card">
          <h3 className="section-title">Historical Order Amounts Needing Review</h3>
          <div className="notice notice-warning" role="status">
            <strong>No payment dates were invented:</strong> The orders below have paid amounts
            recorded before individual payment transactions were tracked, so they are excluded from
            Daily Collections until reviewed.
          </div>
          <div className="collections-list">
            {historicalReviewOrders.map(({ order, unrecordedUgx }) => (
              <div key={order.orderId} className="collection-row">
                <div className="collection-row-main">
                  <div className="collection-row-top">
                    <span className="order-id-badge">{order.orderId}</span>
                    <span>Order Date: {formatDateDisplay(order.orderDate)}</span>
                  </div>
                  <div className="collection-row-desc">
                    <strong>{order.customerName}</strong> &middot; {order.description}
                  </div>
                </div>
                <strong className="collection-amount">{formatUgx(unrecordedUgx)}</strong>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
};
