import React, { useMemo, useRef, useState } from 'react';
import type {
  PaymentMethod,
  PaymentTransaction,
  StaffUser,
  WalkInSaleInput,
} from '../types/order';
import {
  generatePaymentId,
  summarizeWalkInSales,
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

interface WalkInSalesPageProps {
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

function getPaymentMethodLabel(method?: PaymentMethod): string {
  if (method === 'cash') return 'Cash';
  if (method === 'mobile_money') return 'Mobile Money';
  return 'Method not recorded';
}

export const WalkInSalesPage: React.FC<WalkInSalesPageProps> = ({
  payments,
  user,
  loading,
  error,
  onRefresh,
  onRecordWalkInSale,
}) => {
  const todayKampala = getKampalaToday();
  const yesterdayKampala = addDaysToDateString(todayKampala, -1);

  const [selectedDate, setSelectedDate] = useState<string>(todayKampala);
  const [description, setDescription] = useState('');
  const [amountRaw, setAmountRaw] = useState('');
  const [walkInMethod, setWalkInMethod] = useState<PaymentMethod>('cash');
  const [saleDate, setSaleDate] = useState(todayKampala);
  const [saleTime, setSaleTime] = useState(() => getKampalaTimeNow());
  const [formErrors, setFormErrors] = useState<WalkInValidationErrors>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const pendingSaleIdRef = useRef<string | null>(null);

  const walkInSummary = useMemo(
    () => summarizeWalkInSales(payments, selectedDate || undefined),
    [payments, selectedDate]
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

  return (
    <section className="stack-md" aria-labelledby="walkin-heading">
      <div className="card">
        <div className="orders-header-row">
          <div>
            <h2 id="walkin-heading" className="section-title">
              Walk-in Sales
            </h2>
            <p className="muted-text">
              Record cakes sold directly at the counter without an existing order. Walk-in sales are
              automatically included in Daily Collections for that date without being counted twice.
            </p>
          </div>
          <button type="button" className="btn btn-secondary btn-sm" onClick={onRefresh}>
            Refresh
          </button>
        </div>

        <p className="help-text">
          Recorded under staff member: <strong>{user.displayName}</strong>.
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
        <div className="orders-header-row">
          <div>
            <h3 className="section-title">
              Walk-in Sales Ledger{' '}
              {selectedDate ? `(${formatDateDisplay(selectedDate)})` : '(All Dates)'}
            </h3>
          </div>
        </div>

        <div className="collections-date-bar">
          <div className="quick-chips" role="group" aria-label="Quick walk-in dates">
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
            <button
              type="button"
              className={`chip ${selectedDate === '' ? 'active' : ''}`}
              onClick={() => setSelectedDate('')}
            >
              All Dates
            </button>
          </div>

          <div className="field collections-date-input">
            <label htmlFor="walkin-filter-date">Filter Date</label>
            <input
              id="walkin-filter-date"
              type="date"
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
            />
          </div>
        </div>

        {loading && (
          <div className="state-card" role="status">
            Loading walk-in sales…
          </div>
        )}

        {!loading && error && (
          <div className="notice notice-error" role="alert">
            {error}
          </div>
        )}

        {!loading && !error && (
          <>
            <div className="collections-summary-grid" aria-label="Walk-in sales totals">
              <div className="summary-tile">
                <span className="money-label">Cash Walk-in Total</span>
                <strong className="summary-value">{formatUgx(walkInSummary.cashUgx)}</strong>
              </div>
              <div className="summary-tile">
                <span className="money-label">Mobile Money Walk-in Total</span>
                <strong className="summary-value">
                  {formatUgx(walkInSummary.mobileMoneyUgx)}
                </strong>
              </div>
              <div className="summary-tile summary-tile-total">
                <span className="money-label">Total Walk-in Sales</span>
                <strong className="summary-value">{formatUgx(walkInSummary.totalUgx)}</strong>
              </div>
            </div>

            {walkInSummary.unspecifiedMethodUgx > 0 && (
              <div className="notice notice-warning" role="status">
                <strong>Older walk-in records without payment method:</strong>{' '}
                {formatUgx(walkInSummary.unspecifiedMethodUgx)} (included in Total Walk-in Sales).
              </div>
            )}

            {walkInSummary.items.length === 0 ? (
              <div className="state-card">
                <p className="muted-text">
                  {selectedDate
                    ? `No walk-in sales recorded on ${formatDateDisplay(selectedDate)}.`
                    : 'No walk-in sales recorded yet.'}
                </p>
              </div>
            ) : (
              <div className="table-wrap">
                <table className="spreadsheet-table" aria-label="Walk-in sales table">
                  <thead>
                    <tr>
                      <th scope="col">Date</th>
                      <th scope="col">Time</th>
                      <th scope="col">Description</th>
                      <th scope="col">Payment Method</th>
                      <th scope="col" className="num-col">
                        Amount (UGX)
                      </th>
                      <th scope="col">Recorded By</th>
                    </tr>
                  </thead>
                  <tbody>
                    {walkInSummary.items.map((item) => (
                      <tr key={item.paymentId}>
                        <td>{formatDateDisplay(item.receivedDate)}</td>
                        <td>{item.receivedTime}</td>
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
                      <th scope="row" colSpan={4}>
                        Cash Total
                      </th>
                      <td className="num-col">
                        <strong>{formatUgx(walkInSummary.cashUgx)}</strong>
                      </td>
                      <td />
                    </tr>
                    <tr>
                      <th scope="row" colSpan={4}>
                        Mobile Money Total
                      </th>
                      <td className="num-col">
                        <strong>{formatUgx(walkInSummary.mobileMoneyUgx)}</strong>
                      </td>
                      <td />
                    </tr>
                    <tr className="table-grand-total">
                      <th scope="row" colSpan={4}>
                        Combined Walk-in Total
                      </th>
                      <td className="num-col">
                        <strong>{formatUgx(walkInSummary.totalUgx)}</strong>
                      </td>
                      <td />
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </>
        )}
      </div>
    </section>
  );
};
