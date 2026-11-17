import React, { useMemo, useState } from 'react';
import type { CakeOrder, StaffUser } from '../types/order';
import { formatUgx } from '../utils/currency';
import { downloadOrdersCsv } from '../utils/csvExport';
import { formatDateDisplay, getKampalaToday, isOlderThanMonths } from '../utils/dateKampala';
import { ConfirmModal } from './ConfirmModal';

interface ArchivePageProps {
  orders: CakeOrder[];
  user: StaffUser;
  onDeleteArchivedOrders: (orderIds: string[]) => Promise<number>;
}

export const ArchivePage: React.FC<ArchivePageProps> = ({
  orders,
  user,
  onDeleteArchivedOrders,
}) => {
  const todayKampala = getKampalaToday();
  const [showAllOrders, setShowAllOrders] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [exportedIds, setExportedIds] = useState<Set<string>>(new Set());
  const [backupVerified, setBackupVerified] = useState(false);
  const [confirmPhrase, setConfirmPhrase] = useState('');
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleting, setDeleting] = useState(false);
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

  const isOwner = user.role === 'owner';
  const allSelectedExported =
    selectedOrders.length > 0 && selectedOrders.every((o) => exportedIds.has(o.orderId));
  const canRequestDelete =
    isOwner &&
    selectedOrders.length > 0 &&
    allSelectedExported &&
    backupVerified &&
    confirmPhrase.trim() === 'DELETE ARCHIVED';

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
      `Exported ${selectedOrders.length} order(s) to ${filename}. Verify the file opens cleanly in Excel before considering any deletion.`
    );
  };

  const handleConfirmDelete = async () => {
    setDeleting(true);
    setErrorMessage(null);
    setStatusMessage(null);
    try {
      const ids = selectedOrders.map((o) => o.orderId);
      const count = await onDeleteArchivedOrders(ids);
      setSelectedIds(new Set());
      setBackupVerified(false);
      setConfirmPhrase('');
      setShowDeleteModal(false);
      setStatusMessage(`Deleted ${count} archived order(s) from the active database.`);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Failed to delete archived orders.');
      setShowDeleteModal(false);
    } finally {
      setDeleting(false);
    }
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
          Firebase first.
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
        <h3 className="section-title">Owner-Only: Delete Archived Records</h3>
        {!isOwner ? (
          <div className="notice notice-warning" role="status">
            <strong>Restricted to Shop Owner:</strong> You are signed in as <code>{user.role}</code>.
            Staff members can export CSV backups, but only the shop owner can delete archived
            orders (enforced in both the UI and <code>firestore.rules</code>).
          </div>
        ) : (
          <div className="stack-md">
            <p className="muted-text">
              Deletion is permanent. To protect customer records, you must first export the selected
              orders to CSV, verify the backup file outside Firebase, and confirm below.
            </p>

            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={backupVerified}
                onChange={(e) => setBackupVerified(e.target.checked)}
                disabled={!allSelectedExported}
              />
              <span>
                I have opened and verified that a complete CSV backup of the selected{' '}
                {selectedOrders.length} order(s) is safely stored outside Firebase.
              </span>
            </label>

            <div className="field">
              <label htmlFor="delete-confirm-phrase">
                Type <code>DELETE ARCHIVED</code> to enable deletion
              </label>
              <input
                id="delete-confirm-phrase"
                type="text"
                value={confirmPhrase}
                onChange={(e) => setConfirmPhrase(e.target.value)}
                placeholder="DELETE ARCHIVED"
                disabled={!allSelectedExported || !backupVerified}
              />
            </div>

            <button
              type="button"
              className="btn btn-danger"
              disabled={!canRequestDelete}
              onClick={() => setShowDeleteModal(true)}
            >
              Permanently Delete Selected Archived Orders ({selectedOrders.length})
            </button>
          </div>
        )}

        <details className="setup-details">
          <summary>Notes on Firebase limits, automation &amp; costs</summary>
          <ul className="setup-steps">
            <li>
              <strong>Spark (Free) vs Blaze Plan:</strong> Scheduled Cloud Functions for automatic
              archiving require the Firebase <strong>Blaze (pay-as-you-go)</strong> plan. Manual
              CSV export + owner deletion works on the free Spark plan.
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

      <ConfirmModal
        open={showDeleteModal}
        title="Permanently Delete Archived Orders?"
        message={`You are about to permanently delete ${selectedOrders.length} order(s) from the active database. This cannot be undone. Proceed only if your external CSV backup is verified.`}
        confirmLabel="Delete Permanently"
        danger
        busy={deleting}
        onConfirm={handleConfirmDelete}
        onCancel={() => setShowDeleteModal(false)}
      />
    </section>
  );
};
