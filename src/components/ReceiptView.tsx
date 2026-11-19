import React, { useState } from 'react';
import type { CakeOrder, PaymentTransaction } from '../types/order';
import { formatUgx } from '../utils/currency';
import { formatDateDisplay, formatTimestampKampala } from '../utils/dateKampala';
import {
  SHOP_NAME,
  downloadReceipt,
  getReceiptDetailLines,
  getReceiptPaymentMethodLabel,
} from '../utils/receipt';

interface ReceiptViewProps {
  order: CakeOrder;
  orderPayments: PaymentTransaction[];
  /** When true the user must print the receipt before they can continue. */
  required: boolean;
  onDone: () => void;
}

export const ReceiptView: React.FC<ReceiptViewProps> = ({
  order,
  orderPayments,
  required,
  onDone,
}) => {
  const [printed, setPrinted] = useState(false);
  const [downloaded, setDownloaded] = useState(false);

  const handlePrint = () => {
    // window.print() blocks until the print dialog is closed in most browsers.
    window.print();
    setPrinted(true);
  };

  const handleDownload = () => {
    downloadReceipt(order, orderPayments);
    setDownloaded(true);
  };

  const canContinue = !required || printed;
  const detailLines = getReceiptDetailLines(order);

  return (
    <section className="stack-md" aria-labelledby="receipt-heading">
      <div className="card receipt-actions-card">
        <h2 id="receipt-heading" className="section-title">
          {required ? 'Print Receipt (Required)' : 'Order Receipt'}
        </h2>
        {required ? (
          <div className="notice notice-warning" role="status">
            Order <strong>{order.orderId}</strong> is saved. Print the receipt for the customer
            before continuing. You can also download a copy.
          </div>
        ) : (
          <p className="muted-text">Print or download a copy of this receipt.</p>
        )}

        <div className="header-actions">
          <button type="button" className="btn btn-primary" onClick={handlePrint}>
            Print Receipt
          </button>
          <button type="button" className="btn btn-secondary" onClick={handleDownload}>
            Download Receipt
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={onDone}
            disabled={!canContinue}
          >
            {required ? 'Continue' : 'Close'}
          </button>
        </div>

        {required && !printed && (
          <p className="help-text">
            Continue unlocks after you click Print Receipt
            {downloaded ? ' (downloading alone does not unlock it)' : ''}.
          </p>
        )}
        {printed && (
          <p className="help-text" role="status">
            Print dialog was opened for this receipt.
          </p>
        )}
        {downloaded && (
          <p className="help-text" role="status">
            Receipt downloaded as a printable file.
          </p>
        )}
      </div>

      <div className="receipt-sheet" aria-label="Receipt preview">
        <h1 className="receipt-shop">{SHOP_NAME}</h1>
        <div className="receipt-sub">Order Receipt</div>
        <div className="receipt-oid">{order.orderId}</div>

        <table className="receipt-table">
          <tbody>
            <tr>
              <th>Order taken</th>
              <td>{formatTimestampKampala(order.createdAt)} (Kampala)</td>
            </tr>
            <tr>
              <th>Customer</th>
              <td>{order.customerName}</td>
            </tr>
            <tr>
              <th>Phone</th>
              <td>{order.customerPhone}</td>
            </tr>
            <tr>
              <th>Pickup</th>
              <td>
                {formatDateDisplay(order.pickupDate)}
                {order.pickupTime ? ` at ${order.pickupTime}` : ''}
              </td>
            </tr>
          </tbody>
        </table>

        <hr className="receipt-rule" />

        <table className="receipt-table">
          <tbody>
            {detailLines.map((l) => (
              <tr key={l.label}>
                <th>{l.label}</th>
                <td>{l.value}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <hr className="receipt-rule" />

        <table className="receipt-table receipt-totals">
          <tbody>
            <tr>
              <th>Total price</th>
              <td className="receipt-num">{formatUgx(order.totalPriceUgx)}</td>
            </tr>
            <tr>
              <th>Amount paid</th>
              <td className="receipt-num">{formatUgx(order.amountPaidUgx)}</td>
            </tr>
            <tr className="receipt-balance">
              <th>Balance due</th>
              <td className="receipt-num">{formatUgx(order.balanceUgx)}</td>
            </tr>
          </tbody>
        </table>

        <table className="receipt-table">
          <tbody>
            {orderPayments.length === 0 ? (
              <tr>
                <td colSpan={3}>No payment transactions recorded.</td>
              </tr>
            ) : (
              orderPayments.map((p) => (
                <tr key={p.paymentId}>
                  <td>
                    {formatDateDisplay(p.receivedDate)} {p.receivedTime}
                  </td>
                  <td>
                    {p.kind === 'order_deposit' ? 'Deposit' : 'Balance payment'} (
                    {getReceiptPaymentMethodLabel(p.paymentMethod)})
                  </td>
                  <td className="receipt-num">{formatUgx(p.amountUgx)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>

        <hr className="receipt-rule" />
        <div className="receipt-note">
          Served by {order.createdByEmail}
          <br />
          Payments are recorded in shop. No online payment was processed.
          <br />
          Please keep this receipt for pickup.
        </div>
      </div>
    </section>
  );
};
