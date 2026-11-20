import React, { useMemo, useRef, useState } from 'react';
import type {
  CakeOrder,
  CashFlowEntry,
  CashFlowEntryInput,
  CashFlowEntryType,
  PaymentMethod,
  PaymentTransaction,
  StaffUser,
} from '../types/order';
import {
  generateCashFlowId,
  getUnrecordedHistoricalAmount,
  summarizeDailyCashFlow,
  summarizeDailyCollections,
  validateCashFlowEntry,
  type CashFlowValidationErrors,
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
  onOpenWalkInSales?: () => void;
  onRecordCashFlowEntry: (
    input: CashFlowEntryInput,
    idempotencyEntryId: string
  ) => Promise<void>;
}

function getPaymentKindLabel(kind: PaymentTransaction['kind']): string {
  if (kind === 'order_deposit') return 'Order Deposit';
  if (kind === 'order_balance') return 'Order Balance';
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
  onOpenWalkInSales,
  onRecordCashFlowEntry,
}) => {
  const todayKampala = getKampalaToday();
  const yesterdayKampala = addDaysToDateString(todayKampala, -1);

  const [selectedDate, setSelectedDate] = useState(todayKampala);

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
          <div className="header-actions">
            {onOpenWalkInSales && (
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={onOpenWalkInSales}
              >
                Walk-in Sales
              </button>
            )}
            <button type="button" className="btn btn-secondary btn-sm" onClick={onRefresh}>
              Refresh
            </button>
          </div>
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
            <div className="summary-tile">
              <span className="money-label">Cash Collected</span>
              <strong className="summary-value">{formatUgx(summary.cashUgx)}</strong>
            </div>
            <div className="summary-tile">
              <span className="money-label">Mobile Money Collected</span>
              <strong className="summary-value">{formatUgx(summary.mobileMoneyUgx)}</strong>
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
          <div className="table-wrap">
            <table className="spreadsheet-table" aria-label="Daily cash-flow table">
              <thead>
                <tr>
                  <th scope="col">Date</th>
                  <th scope="col">Time</th>
                  <th scope="col">Type</th>
                  <th scope="col">Description</th>
                  <th scope="col">Payment Method</th>
                  <th scope="col" className="num-col">
                    Amount (UGX)
                  </th>
                  <th scope="col">Recorded By</th>
                </tr>
              </thead>
              <tbody>
                {cashFlowSummary.cashFlowItems.map((entry) => (
                  <tr key={entry.entryId}>
                    <td>{formatDateDisplay(entry.entryDate)}</td>
                    <td>{entry.entryTime}</td>
                    <td>
                      <span className={`kind-badge kind-${entry.type}`}>
                        {entry.type === 'expense' ? 'Money Out: Expense' : 'Money In: Other Sale'}
                      </span>
                    </td>
                    <td>{entry.description}</td>
                    <td>
                      <span className="method-badge">
                        {getPaymentMethodLabel(entry.paymentMethod)}
                      </span>
                    </td>
                    <td className="num-col">
                      <strong>
                        {entry.type === 'expense' ? '-' : '+'}
                        {formatUgx(entry.amountUgx)}
                      </strong>
                    </td>
                    <td>{entry.recordedByName || entry.recordedByEmail}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
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
          <div className="table-wrap">
            <table className="spreadsheet-table" aria-label="Itemised daily collections table">
              <thead>
                <tr>
                  <th scope="col">Date</th>
                  <th scope="col">Time</th>
                  <th scope="col">Type</th>
                  <th scope="col">Order / Ref</th>
                  <th scope="col">Customer / Source</th>
                  <th scope="col">Description</th>
                  <th scope="col">Payment Method</th>
                  <th scope="col" className="num-col">
                    Amount (UGX)
                  </th>
                  <th scope="col">Recorded By</th>
                </tr>
              </thead>
              <tbody>
                {summary.items.map((item) => (
                  <tr key={item.paymentId}>
                    <td>{formatDateDisplay(item.receivedDate)}</td>
                    <td>{item.receivedTime}</td>
                    <td>
                      <span className={`kind-badge kind-${item.kind}`}>
                        {getPaymentKindLabel(item.kind)}
                      </span>
                    </td>
                    <td>
                      <span className="order-id-badge">{item.orderId || 'Walk-in'}</span>
                    </td>
                    <td>
                      <strong>{item.orderId ? item.customerName : 'Walk-in Sale'}</strong>
                    </td>
                    <td>{item.description}</td>
                    <td>
                      <span className="method-badge">
                        {getPaymentMethodLabel(item.paymentMethod)}
                      </span>
                    </td>
                    <td className="num-col">
                      <strong>{formatUgx(item.amountUgx)}</strong>
                    </td>
                    <td>{item.recordedByName || item.recordedByEmail}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <th scope="row" colSpan={7}>
                    Cash Total
                  </th>
                  <td className="num-col">
                    <strong>{formatUgx(summary.cashUgx)}</strong>
                  </td>
                  <td />
                </tr>
                <tr>
                  <th scope="row" colSpan={7}>
                    Mobile Money Total
                  </th>
                  <td className="num-col">
                    <strong>{formatUgx(summary.mobileMoneyUgx)}</strong>
                  </td>
                  <td />
                </tr>
                <tr className="table-grand-total">
                  <th scope="row" colSpan={7}>
                    Total Collected
                  </th>
                  <td className="num-col">
                    <strong>{formatUgx(summary.totalCollectedUgx)}</strong>
                  </td>
                  <td />
                </tr>
              </tfoot>
            </table>
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
