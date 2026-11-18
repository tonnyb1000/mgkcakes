import React, { useMemo, useRef, useState } from 'react';
import type {
  CakeOrder,
  CashFlowEntry,
  CashFlowEntryInput,
  CashFlowEntryType,
  PaymentMethod,
  PaymentTransaction,
  StaffUser,
  WalkInSaleInput,
} from '../types/order';
import {
  generateCashFlowId,
  generatePaymentId,
  getUnrecordedHistoricalAmount,
  summarizeDailyCashFlow,
  summarizeDailyCollections,
  validateCashFlowEntry,
  validateWalkInSale,
  type CashFlowValidationErrors,
  type WalkInValidationErrors,
} from '../utils/collections';
import { formatUgx } from '../utils/currency';
import {
  addDaysToDateString,
  formatDateDisplay,
  formatTimestampKampala,
  getKampalaTimeNow,
  getKampalaToday,
} from '../utils/dateKampala';

interface SalesCollectionsPageProps {
  orders: CakeOrder[];
  payments: PaymentTransaction[];
  cashFlowEntries: CashFlowEntry[];
  user: StaffUser;
  loading: boolean;
  error: string | null;
  onRefresh: () => void;
  onRecordWalkInSale: (
    input: WalkInSaleInput,
    idempotencyPaymentId: string
  ) => Promise<void>;
  onRecordCashFlowEntry: (
    input: CashFlowEntryInput,
    idempotencyEntryId: string
  ) => Promise<void>;
}

function getPaymentKindLabel(kind: PaymentTransaction['kind']): string {
  if (kind === 'order_deposit') return 'Order Deposit';
  if (kind === 'order_balance') return 'Later Order Payment';
  return 'Walk-in Sale';
}

function formatSignedUgx(amount: number): string {
  if (amount < 0) return `-${formatUgx(Math.abs(amount))}`;
  if (amount > 0) return `+${formatUgx(amount)}`;
  return formatUgx(0);
}

function getPaymentMethodLabel(method?: PaymentMethod): string {
  if (method === 'cash') return 'Cash';
  if (method === 'mobile_money') return 'Mobile Money';
  return 'Method not recorded';
}

export const SalesCollectionsPage: React.FC<SalesCollectionsPageProps> = ({
  orders,
  payments,
  cashFlowEntries,
  user,
  loading,
  error,
  onRefresh,
  onRecordWalkInSale,
  onRecordCashFlowEntry,
}) => {
  const todayKampala = getKampalaToday();
  const yesterdayKampala = addDaysToDateString(todayKampala, -1);

  const [selectedDate, setSelectedDate] = useState(todayKampala);

  // Walk-in cake sale form state
  const [description, setDescription] = useState('');
  const [amountRaw, setAmountRaw] = useState('');
  const [walkInMethod, setWalkInMethod] = useState<PaymentMethod>('cash');
  const [saleDate, setSaleDate] = useState(todayKampala);
  const [saleTime, setSaleTime] = useState(() => getKampalaTimeNow());
  const [formErrors, setFormErrors] = useState<WalkInValidationErrors>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const pendingSaleIdRef = useRef<string | null>(null);

  // Daily cash-flow (expenses & other item sales) form state
  const [cfType, setCfType] = useState<CashFlowEntryType>('expense');
  const [cfMethod, setCfMethod] = useState<PaymentMethod>('cash');
  const [cfDescription, setCfDescription] = useState('');
  const [cfAmountRaw, setCfAmountRaw] = useState('');
  const [cfDate, setCfDate] = useState(todayKampala);
  const [cfTime, setCfTime] = useState(() => getKampalaTimeNow());
  const [cfErrors, setCfErrors] = useState<CashFlowValidationErrors>({});
  const [cfSubmitError, setCfSubmitError] = useState<string | null>(null);
  const [cfSaving, setCfSaving] = useState(false);
  const pendingCfIdRef = useRef<string | null>(null);

  const summary = useMemo(
    () => summarizeDailyCollections(payments, selectedDate, orders),
    [payments, selectedDate, orders]
  );

  const cashFlowSummary = useMemo(
    () => summarizeDailyCashFlow(payments, cashFlowEntries, selectedDate, orders),
    [payments, cashFlowEntries, selectedDate, orders]
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
      paymentMethod: walkInMethod,
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
      if (!pendingSaleIdRef.current) {
        pendingSaleIdRef.current = generatePaymentId(saleDate);
      }
      await onRecordWalkInSale(input, pendingSaleIdRef.current);
      pendingSaleIdRef.current = null;
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

  const handleCashFlowSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (cfSaving) return;

    setCfSubmitError(null);
    const amountUgx = cfAmountRaw === '' ? 0 : Number(cfAmountRaw);
    const input: CashFlowEntryInput = {
      type: cfType,
      paymentMethod: cfMethod,
      description: cfDescription,
      amountUgx: Number.isNaN(amountUgx) ? 0 : amountUgx,
      entryDate: cfDate,
      entryTime: cfTime,
    };

    const validation = validateCashFlowEntry(input);
    if (Object.keys(validation).length > 0) {
      setCfErrors(validation);
      return;
    }

    setCfSaving(true);
    try {
      if (!pendingCfIdRef.current) {
        pendingCfIdRef.current = generateCashFlowId(cfDate);
      }
      await onRecordCashFlowEntry(input, pendingCfIdRef.current);
      pendingCfIdRef.current = null;
      setCfDescription('');
      setCfAmountRaw('');
      setCfErrors({});
      setSelectedDate(cfDate);
    } catch (err) {
      setCfSubmitError(
        err instanceof Error ? err.message : 'Failed to record cash-flow transaction.'
      );
    } finally {
      setCfSaving(false);
    }
  };

  return (
    <section className="stack-md" aria-labelledby="collections-heading">
      <div className="card">
        <div className="orders-header-row">
          <div>
            <h2 id="collections-heading" className="section-title">
              Daily Collections &amp; Cash-Flow
            </h2>
            <p className="muted-text">
              Collections and daily cash-flow for the selected date (Africa/Kampala). Daily
              Collections shows cake money received only (not profit or a balance sheet).
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

      {/* Daily Cash-Flow Summary & Entry Section */}
      <div className="card">
        <h3 className="section-title">
          Daily Cash-Flow ({formatDateDisplay(selectedDate)})
        </h3>
        <p className="muted-text">
          Order payments, walk-in cake sales, and other item sales as <strong>Money In</strong>;
          expenses as <strong>Money Out</strong>. Cash and Mobile Money are tracked separately.
        </p>

        <div className="cashflow-method-grid" aria-label="Daily cash-flow summary">
          <div className="summary-tile" aria-label="Cash cash-flow">
            <span className="method-tile-title">Cash</span>
            <div className="method-metric-row">
              <span>Money In</span>
              <strong>{formatUgx(cashFlowSummary.cash.moneyInUgx)}</strong>
            </div>
            <div className="method-metric-row">
              <span>Money Out</span>
              <strong>{formatUgx(cashFlowSummary.cash.moneyOutUgx)}</strong>
            </div>
            <div className="method-metric-row method-metric-net">
              <span>Net Movement</span>
              <strong>{formatSignedUgx(cashFlowSummary.cash.netMovementUgx)}</strong>
            </div>
          </div>

          <div className="summary-tile" aria-label="Mobile Money cash-flow">
            <span className="method-tile-title">Mobile Money</span>
            <div className="method-metric-row">
              <span>Money In</span>
              <strong>{formatUgx(cashFlowSummary.mobileMoney.moneyInUgx)}</strong>
            </div>
            <div className="method-metric-row">
              <span>Money Out</span>
              <strong>{formatUgx(cashFlowSummary.mobileMoney.moneyOutUgx)}</strong>
            </div>
            <div className="method-metric-row method-metric-net">
              <span>Net Movement</span>
              <strong>{formatSignedUgx(cashFlowSummary.mobileMoney.netMovementUgx)}</strong>
            </div>
          </div>

          <div className="summary-tile summary-tile-total" aria-label="Combined cash-flow total">
            <span className="method-tile-title">Combined Total</span>
            <div className="method-metric-row">
              <span>Money In</span>
              <strong>{formatUgx(cashFlowSummary.totalMoneyInUgx)}</strong>
            </div>
            <div className="method-metric-row">
              <span>Money Out</span>
              <strong>{formatUgx(cashFlowSummary.expensesOutUgx)}</strong>
            </div>
            <div className="method-metric-row method-metric-net">
              <span>Net Movement</span>
              <strong>{formatSignedUgx(cashFlowSummary.netMovementUgx)}</strong>
            </div>
          </div>
        </div>

        {(cashFlowSummary.unspecified.moneyInUgx > 0 ||
          cashFlowSummary.unspecified.moneyOutUgx > 0) && (
          <div className="notice notice-warning" role="status">
            <strong>Older records without payment method (not guessed):</strong> Money In{' '}
            {formatUgx(cashFlowSummary.unspecified.moneyInUgx)} &middot; Money Out{' '}
            {formatUgx(cashFlowSummary.unspecified.moneyOutUgx)} &middot; Net{' '}
            {formatSignedUgx(cashFlowSummary.unspecified.netMovementUgx)} (included in Combined
            Total above).
          </div>
        )}

        <hr className="section-divider" />

        <h4 className="subsection-title">Record Expense or Other Item Sale</h4>
        <p className="muted-text">
          Audit record saved under staff member: <strong>{user.displayName}</strong>.
        </p>

        {cfSubmitError && (
          <div className="notice notice-error" role="alert">
            {cfSubmitError}
          </div>
        )}

        <form onSubmit={handleCashFlowSubmit} className="stack-md" noValidate>
          <div className="grid-2">
            <div className="field">
              <label htmlFor="cf-type">Transaction Type *</label>
              <select
                id="cf-type"
                value={cfType}
                onChange={(e) => {
                  setCfType(e.target.value as CashFlowEntryType);
                  pendingCfIdRef.current = null;
                }}
              >
                <option value="expense">Expense (Money Out)</option>
                <option value="other_sale">Other Item Sale (Money In)</option>
              </select>
            </div>

            <div className="field">
              <label htmlFor="cf-method">Payment Method *</label>
              <select
                id="cf-method"
                value={cfMethod}
                onChange={(e) => {
                  setCfMethod(e.target.value as PaymentMethod);
                  pendingCfIdRef.current = null;
                }}
              >
                <option value="cash">Cash</option>
                <option value="mobile_money">Mobile Money</option>
              </select>
            </div>
          </div>

          <div className="grid-2">
            <div className="field">
              <label htmlFor="cf-desc">Description *</label>
              <input
                id="cf-desc"
                type="text"
                value={cfDescription}
                onChange={(e) => {
                  setCfDescription(e.target.value);
                  setCfErrors((prev) => ({ ...prev, description: undefined }));
                  pendingCfIdRef.current = null;
                }}
                placeholder={
                  cfType === 'expense'
                    ? 'e.g. Cooking gas, butter, cake boxes'
                    : 'e.g. Candles, cake topper, juice'
                }
                aria-invalid={Boolean(cfErrors.description)}
                required
              />
              {cfErrors.description && (
                <span className="field-error">{cfErrors.description}</span>
              )}
            </div>

            <div className="field">
              <label htmlFor="cf-amount">Amount (UGX) *</label>
              <input
                id="cf-amount"
                type="number"
                min={1}
                step={500}
                value={cfAmountRaw}
                onChange={(e) => {
                  setCfAmountRaw(e.target.value);
                  setCfErrors((prev) => ({ ...prev, amountUgx: undefined }));
                  pendingCfIdRef.current = null;
                }}
                placeholder="e.g. 25000"
                aria-invalid={Boolean(cfErrors.amountUgx)}
                required
              />
              {cfErrors.amountUgx && (
                <span className="field-error">{cfErrors.amountUgx}</span>
              )}
            </div>
          </div>

          <div className="grid-2">
            <div className="field">
              <label htmlFor="cf-date">Cash-Flow Date *</label>
              <input
                id="cf-date"
                type="date"
                value={cfDate}
                onChange={(e) => {
                  setCfDate(e.target.value);
                  pendingCfIdRef.current = null;
                }}
                required
              />
              {cfErrors.entryDate && <span className="field-error">{cfErrors.entryDate}</span>}
            </div>

            <div className="field">
              <label htmlFor="cf-time">Cash-Flow Time *</label>
              <input
                id="cf-time"
                type="time"
                value={cfTime}
                onChange={(e) => {
                  setCfTime(e.target.value);
                  pendingCfIdRef.current = null;
                }}
                required
              />
              {cfErrors.entryTime && <span className="field-error">{cfErrors.entryTime}</span>}
            </div>
          </div>

          <div className="form-actions">
            <button type="submit" className="btn btn-primary" disabled={cfSaving}>
              {cfSaving
                ? 'Recording…'
                : cfType === 'expense'
                ? 'Record Expense'
                : 'Record Other Sale'}
            </button>
          </div>
        </form>

        {cashFlowSummary.cashFlowItems.length > 0 && (
          <div className="collections-list">
            {cashFlowSummary.cashFlowItems.map((entry) => (
              <div key={entry.entryId} className="collection-row">
                <div className="collection-row-main">
                  <div className="collection-row-top">
                    <span className={`kind-badge kind-${entry.type}`}>
                      {entry.type === 'expense' ? 'Money Out: Expense' : 'Money In: Other Sale'}
                    </span>
                    <span className="method-badge">
                      {getPaymentMethodLabel(entry.paymentMethod)}
                    </span>
                    <span className="collection-time">{entry.entryTime}</span>
                    <span className="order-id-badge">{entry.entryId}</span>
                  </div>
                  <div className="collection-row-desc">{entry.description}</div>
                  <div className="collection-row-staff">
                    Entered by {entry.recordedByName || entry.recordedByEmail} (
                    {formatTimestampKampala(entry.createdAt)})
                  </div>
                </div>
                <strong className="collection-amount">
                  {entry.type === 'expense' ? '-' : '+'}
                  {formatUgx(entry.amountUgx)}
                </strong>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="card">
        <h3 className="section-title">Record Walk-in Cake Sale</h3>
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
                  pendingSaleIdRef.current = null;
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
                  pendingSaleIdRef.current = null;
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

          <div className="grid-3">
            <div className="field">
              <label htmlFor="walkin-method">Payment Method *</label>
              <select
                id="walkin-method"
                value={walkInMethod}
                onChange={(e) => {
                  setWalkInMethod(e.target.value as PaymentMethod);
                  pendingSaleIdRef.current = null;
                }}
              >
                <option value="cash">Cash</option>
                <option value="mobile_money">Mobile Money</option>
              </select>
            </div>

            <div className="field">
              <label htmlFor="walkin-date">Date *</label>
              <input
                id="walkin-date"
                type="date"
                value={saleDate}
                onChange={(e) => {
                  setSaleDate(e.target.value);
                  pendingSaleIdRef.current = null;
                }}
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
                onChange={(e) => {
                  setSaleTime(e.target.value);
                  pendingSaleIdRef.current = null;
                }}
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
              No active order payments or walk-in sales recorded on {formatDateDisplay(selectedDate)}.
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
                    <span className="method-badge">
                      {getPaymentMethodLabel(item.paymentMethod)}
                    </span>
                    <span className="collection-time">{item.receivedTime}</span>
                    {item.orderId ? (
                      <span className="order-id-badge">{item.orderId}</span>
                    ) : (
                      <span className="order-id-badge">Walk-in</span>
                    )}
                  </div>
                  <div className="collection-row-desc">
                    <strong>{item.orderId ? item.customerName : 'Walk-in Sale'}</strong> &middot;{' '}
                    {item.description}
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

        {summary.excludedDeletedItems.length > 0 && (
          <div className="excluded-deleted-section">
            <h4 className="subsection-title">
              Retained Payment History for Deleted Orders (Excluded from Totals)
            </h4>
            <div className="collections-list">
              {summary.excludedDeletedItems.map(({ payment, deletedOrder }) => (
                <div key={payment.paymentId} className="collection-row collection-row-excluded">
                  <div className="collection-row-main">
                    <div className="collection-row-top">
                      <span className="status-badge status-deleted">Excluded (Order Deleted)</span>
                      <span className="order-id-badge">{payment.orderId}</span>
                      <span className="collection-time">{payment.receivedTime}</span>
                    </div>
                    <div className="collection-row-desc">
                      <strong>{payment.customerName}</strong> &middot; {payment.description}
                    </div>
                    <div className="collection-row-staff">
                      Order deleted by{' '}
                      <strong>
                        {deletedOrder.deletedByName || deletedOrder.deletedByEmail}
                      </strong>{' '}
                      on {formatTimestampKampala(deletedOrder.deletedAt ?? '')}
                    </div>
                  </div>
                  <strong className="collection-amount excluded-amount">
                    {formatUgx(payment.amountUgx)}
                  </strong>
                </div>
              ))}
            </div>
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
