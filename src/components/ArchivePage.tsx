import React, { useMemo, useState } from 'react';
import type { CakeOrder, StaffUser } from '../types/order';
import { formatUgx } from '../utils/currency';
import { downloadOrdersCsv } from '../utils/csvExport';
import { formatDateDisplay, getKampalaToday, isOlderThanMonths } from '../utils/dateKampala';

interface ArchivePageProps {
  orders: CakeOrder[];
  user: StaffUser;
  onDeleteArchivedOrders?: (orderIds: string[]) => Promise<number>;
}

export const ArchivePage: React.FC<ArchivePageProps> = ({ orders }) => {
  const todayKampala = getKampalaToday();
  const [showAllOrders, setShowAllOrders] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [exportedIds, setExportedIds] = useState<Set<string>>(new Set());
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const olderThan12Months = useMemo(
    () => orders.filter((o) => isOlderThanMonths(o.pickupDate, 12, todayKampala)),
    [orders, todayKampala]
  );

  const visibleOrders = showAllOrders ? orders : olderThan12Months;
  const selectedOrders = useMemo(
    () => visibleOrders.filter((o) => selectedIds.has(o.orderId)),
    [visibleOrders, selectedIds]
  );

  const toggleSelect = (orderId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(orderId)) {
        next.delete(orderId);
      } else {
        next.add(orderId);
      }
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedOrders.length === visibleOrders.length && visibleOrders.length > 0) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(visibleOrders.map((o) => o.orderId)));
    }
  };

  const handleExportCsv = () => {
    setErrorMessage(null);
    setStatusMessage(null);
    if (selectedOrders.length === 0) {
      setErrorMessage('Select at least one order to export.');
      return;
    }
    const filename = `cake-orders-archive-${todayKampala}.csv`;
    downloadOrdersCsv(selectedOrders, filename);
    setExportedIds((prev) => {
      const next = new Set(prev);
      for (const order of selectedOrders) {
        next.add(order.orderId);
      }
      return next;
    });
    setStatusMessage(
      `Exported ${selectedOrders.length} order(s) to ${filename}. Verify the file opens cleanly in Excel.`
    );
  };

  return (
    <section className="stack-md" aria-labelledby="archive-heading">
      <div className="card">
        <h2 id="archive-heading" className="section-title">
          Archiving &amp; Excel CSV Export
        </h2>
        <p className="muted-text">
          Active database retention guideline: keep approximately the latest{' '}
          <strong>12 months</strong> of orders in Firestore. Orders older than 12 months are{' '}
          <strong>never</strong> deleted automatically. Export a verified CSV backup outside
          Firebase.
        </p>

        <div className="archive-controls">
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={showAllOrders}
              onChange={(e) => {
                setShowAllOrders(e.target.checked);
                setSelectedIds(new Set());
              }}
            />
            <span>Show all orders (instead of only orders older than 12 months)</span>
          </label>

          <div className="archive-buttons">
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={toggleSelectAll}
              disabled={visibleOrders.length === 0}
            >
              {selectedOrders.length === visibleOrders.length && visibleOrders.length > 0
                ? 'Unselect All'
                : `Select All (${visibleOrders.length})`}
            </button>

            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={handleExportCsv}
              disabled={selectedOrders.length === 0}
            >
              Export Selected to CSV ({selectedOrders.length})
            </button>
          </div>
        </div>

        {statusMessage && (
          <div className="notice notice-success" role="status">
            {statusMessage}
          </div>
        )}
        {errorMessage && (
          <div className="notice notice-error" role="alert">
            {errorMessage}
          </div>
        )}

        {visibleOrders.length === 0 ? (
          <div className="state-card">
            <p className="muted-text">
              No orders older than 12 months found (cutoff relative to Kampala today:{' '}
              {formatDateDisplay(todayKampala)}).
            </p>
          </div>
        ) : (
          <div className="archive-list">
            {visibleOrders.map((order) => {
              const checked = selectedIds.has(order.orderId);
              const exported = exportedIds.has(order.orderId);
              return (
                <label key={order.orderId} className={`archive-row ${checked ? 'selected' : ''}`}>
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleSelect(order.orderId)}
                  />
                  <div className="archive-row-body">
                    <div className="archive-row-top">
                      <strong>{order.orderId}</strong>
                      <span>Pickup: {formatDateDisplay(order.pickupDate)}</span>
                      {exported && <span className="exported-pill">Exported this session</span>}
                    </div>
                    <div className="archive-row-sub">
                      <span>{order.customerName}</span>
                      <span>{order.customerPhone}</span>
                      <span>{formatUgx(order.totalPriceUgx)}</span>
                      <span>
                        {order.pickupStatus === 'picked_up' ? 'Picked up' : 'Waiting for pickup'}
                      </span>
                    </div>
                  </div>
                </label>
              );
            })}
          </div>
        )}
      </div>

      <div className="card danger-zone">
        <h3 className="section-title">Deletion Disabled Pending Backup Safeguards</h3>
        <div className="notice notice-warning" role="status">
          <strong>Order and payment deletion is disabled:</strong> To protect customer and financial
          records, deleting orders or payment transactions is blocked in both the app and{' '}
          <code>firestore.rules</code> (<code>allow delete: if false</code>) until verified external
          backup safeguards are enforced. Use <strong>Export Selected to CSV</strong> above to save
          offline backups.
        </div>

        <details className="setup-details">
          <summary>Notes on Firebase limits, automation &amp; costs</summary>
          <ul className="setup-steps">
            <li>
              <strong>Spark (Free) vs Blaze Plan:</strong> Scheduled Cloud Functions for automatic
              archiving require the Firebase <strong>Blaze (pay-as-you-go)</strong> plan. Manual
              CSV export works on the free Spark plan.
            </li>
            <li>
              <strong>Firestore Billing:</strong> Firestore charges per document read, write, and
              delete. Keeping ~12 months of active orders keeps list queries fast and well within
              free-tier quotas for a small shop.
            </li>
            <li>
              <strong>CSV Safety:</strong> Exports include UTF-8 BOM for Excel, preserve phone
              numbers as text, and neutralize cells starting with <code>=</code>, <code>+</code>,{' '}
              <code>-</code>, or <code>@</code> to prevent spreadsheet formula injection.
            </li>
          </ul>
        </details>
      </div>
    </section>
  );
};
