import React, { useMemo, useState } from 'react';
import type { CakeOrder, PaymentTransaction, PickupStatus } from '../types/order';
import { getUnrecordedHistoricalAmount } from '../utils/collections';
import { formatUgx } from '../utils/currency';
import {
  formatDateDisplay,
  formatTimestampKampala,
  getKampalaToday,
  getKampalaTomorrow,
} from '../utils/dateKampala';
import { ConfirmModal } from './ConfirmModal';

type QuickView = 'all' | 'today' | 'tomorrow' | 'waiting' | 'picked_up';
type DateFieldFilter = 'pickupDate' | 'orderDate';

interface OrdersPageProps {
  orders: CakeOrder[];
  payments?: PaymentTransaction[];
  loading: boolean;
  error: string | null;
  onRefresh: () => void;
  onEditOrder: (order: CakeOrder) => void;
  onTogglePickupStatus: (order: CakeOrder, nextStatus: PickupStatus) => Promise<void>;
  onCreateNew: () => void;
}

function getCardTierCount(order: CakeOrder): number {
  if (order.tierDetails && order.tierDetails.length > 0) {
    return order.tierDetails.length;
  }
  const parsed = Number.parseInt(order.tiers, 10);
  if (Number.isFinite(parsed) && parsed >= 1 && parsed <= 10) {
    return parsed;
  }
  return 1;
}

function getMiniCylinderWidth(tierNumber: number, count: number): number {
  if (count <= 1) return 76;
  const step = 42 / Math.max(1, count - 1);
  return Math.round(92 - (tierNumber - 1) * step);
}

export const OrdersPage: React.FC<OrdersPageProps> = ({
  orders,
  payments = [],
  loading,
  error,
  onRefresh,
  onEditOrder,
  onTogglePickupStatus,
  onCreateNew,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [quickView, setQuickView] = useState<QuickView>('all');
  const [dateField, setDateField] = useState<DateFieldFilter>('pickupDate');
  const [selectedDate, setSelectedDate] = useState('');
  const [pendingToggle, setPendingToggle] = useState<{
    order: CakeOrder;
    nextStatus: PickupStatus;
  } | null>(null);
  const [toggling, setToggling] = useState(false);

  const todayKampala = getKampalaToday();
  const tomorrowKampala = getKampalaTomorrow();

  const filteredOrders = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();

    return orders.filter((order) => {
      if (q) {
        const matchesSearch =
          order.orderId.toLowerCase().includes(q) ||
          order.customerName.toLowerCase().includes(q) ||
          order.customerPhone.toLowerCase().includes(q);
        if (!matchesSearch) return false;
      }

      if (quickView === 'today' && order.pickupDate !== todayKampala) return false;
      if (quickView === 'tomorrow' && order.pickupDate !== tomorrowKampala) return false;
      if (quickView === 'waiting' && order.pickupStatus !== 'waiting') return false;
      if (quickView === 'picked_up' && order.pickupStatus !== 'picked_up') return false;

      if (selectedDate) {
        const target = dateField === 'pickupDate' ? order.pickupDate : order.orderDate;
        if (target !== selectedDate) return false;
      }

      return true;
    });
  }, [orders, searchQuery, quickView, selectedDate, dateField, todayKampala, tomorrowKampala]);

  const handleConfirmToggle = async () => {
    if (!pendingToggle) return;
    setToggling(true);
    try {
      await onTogglePickupStatus(pendingToggle.order, pendingToggle.nextStatus);
      setPendingToggle(null);
    } finally {
      setToggling(false);
    }
  };

  const clearFilters = () => {
    setSearchQuery('');
    setQuickView('all');
    setSelectedDate('');
  };

  return (
    <section className="stack-md" aria-labelledby="orders-heading">
      <div className="card filters-card">
        <div className="orders-header-row">
          <div>
            <h2 id="orders-heading" className="section-title">
              Orders
            </h2>
            <p className="muted-text">
              Today: <strong>{formatDateDisplay(todayKampala)}</strong> &middot; Tomorrow:{' '}
              <strong>{formatDateDisplay(tomorrowKampala)}</strong>
            </p>
          </div>
          <div className="header-actions">
            <button type="button" className="btn btn-secondary btn-sm" onClick={onRefresh}>
              Refresh
            </button>
            <button type="button" className="btn btn-primary btn-sm" onClick={onCreateNew}>
              New Order
            </button>
          </div>
        </div>

        <div className="quick-chips" role="group" aria-label="Quick order views">
          {(
            [
              ['all', 'All'],
              ['today', 'Today'],
              ['tomorrow', 'Tomorrow'],
              ['waiting', 'Waiting'],
              ['picked_up', 'Picked up'],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              className={`chip ${quickView === key ? 'active' : ''}`}
              onClick={() => {
                setQuickView(key);
                if (key === 'today' || key === 'tomorrow') {
                  setSelectedDate('');
                }
              }}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="filter-controls">
          <div className="field search-field">
            <label htmlFor="order-search">Search Name, Phone, or Order ID</label>
            <input
              id="order-search"
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="e.g. Amina, 0772, or ORD-..."
            />
          </div>

          <div className="field">
            <label htmlFor="date-filter-field">Filter Date</label>
            <select
              id="date-filter-field"
              value={dateField}
              onChange={(e) => setDateField(e.target.value as DateFieldFilter)}
            >
              <option value="pickupDate">Pickup Date</option>
              <option value="orderDate">Order Date</option>
            </select>
          </div>

          <div className="field">
            <label htmlFor="date-filter-value">Choose Date</label>
            <input
              id="date-filter-value"
              type="date"
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
            />
          </div>

          {(searchQuery || quickView !== 'all' || selectedDate) && (
            <div className="field filter-clear-wrap">
              <button type="button" className="btn btn-ghost btn-sm" onClick={clearFilters}>
                Clear
              </button>
            </div>
          )}
        </div>
      </div>

      {loading && (
        <div className="card state-card" role="status">
          Loading orders…
        </div>
      )}

      {!loading && error && (
        <div className="notice notice-error" role="alert">
          {error}
        </div>
      )}

      {!loading && !error && filteredOrders.length === 0 && (
        <div className="card state-card">
          <p className="muted-text">
            {orders.length === 0
              ? 'No orders yet.'
              : 'No orders match your search or date filter.'}
          </p>
          {orders.length === 0 ? (
            <button type="button" className="btn btn-primary" onClick={onCreateNew}>
              New Order
            </button>
          ) : (
            <button type="button" className="btn btn-secondary" onClick={clearFilters}>
              Show All Orders
            </button>
          )}
        </div>
      )}

      {!loading && !error && filteredOrders.length > 0 && (
        <div className="orders-list" aria-live="polite">
          {filteredOrders.map((order) => {
            const isPickedUp = order.pickupStatus === 'picked_up';
            const nextStatus: PickupStatus = isPickedUp ? 'waiting' : 'picked_up';
            const unrecordedHistorical =
              payments.length > 0 ? getUnrecordedHistoricalAmount(order, payments) : 0;

            return (
              <article key={order.orderId} className="card order-card">
                <div className="order-status-strip">
                  <span
                    className={`status-badge ${
                      isPickedUp ? 'status-picked-up' : 'status-waiting'
                    }`}
                  >
                    {isPickedUp ? 'Picked up' : 'Waiting for pickup'}
                  </span>
                  {unrecordedHistorical > 0 && (
                    <span className="status-badge status-review">
                      Historical payment needs review
                    </span>
                  )}
                  <span
                    className={`balance-pill ${
                      order.balanceUgx === 0 ? 'balance-pill-paid' : 'balance-pill-due'
                    }`}
                  >
                    {order.balanceUgx === 0
                      ? 'Balance: UGX 0 (Paid)'
                      : `Balance: ${formatUgx(order.balanceUgx)}`}
                  </span>
                </div>

                <div className="order-card-top">
                  <div>
                    <span className="order-id-badge">{order.orderId}</span>
                    <h3 className="customer-name">{order.customerName}</h3>
                    <p className="customer-phone">{order.customerPhone}</p>
                    <p className="help-text">
                      Created: {formatTimestampKampala(order.createdAt)}
                    </p>
                  </div>

                  <div className="pickup-block">
                    <span className="pickup-label">Pickup</span>
                    <strong className="pickup-date">{formatDateDisplay(order.pickupDate)}</strong>
                    {order.pickupTime && <span className="pickup-time">{order.pickupTime}</span>}
                  </div>
                </div>

                <p className="order-desc">{order.description}</p>

                <div className="order-cake-visual" aria-label={`Cake tier illustration for ${order.orderId}`}>
                  <div className="order-cake-stack" aria-hidden="true">
                    {(() => {
                      const count = getCardTierCount(order);
                      const savedTiers =
                        order.tierDetails && order.tierDetails.length > 0
                          ? [...order.tierDetails].sort((a, b) => b.tierNumber - a.tierNumber)
                          : Array.from({ length: count }, (_, idx) => ({
                              tierNumber: count - idx,
                              shape: '',
                              priceUgx: 0,
                            }));
                      return savedTiers.map((t) => (
                        <div
                          key={t.tierNumber}
                          className="mini-cylinder"
                          style={{ width: `${getMiniCylinderWidth(t.tierNumber, count)}%` }}
                        >
                          <div className="mini-cylinder-top" />
                          <div className="mini-cylinder-body" />
                        </div>
                      ));
                    })()}
                  </div>

                  <div className="order-cake-meta">
                    {order.tierDetails && order.tierDetails.length > 0 ? (
                      <ul className="order-tier-list">
                        {[...order.tierDetails]
                          .sort((a, b) => b.tierNumber - a.tierNumber)
                          .map((t) => (
                            <li key={t.tierNumber}>
                              <span>
                                Tier {t.tierNumber}
                                {t.shape ? ` (${t.shape})` : ''}
                              </span>
                              <strong>{formatUgx(t.priceUgx)}</strong>
                            </li>
                          ))}
                      </ul>
                    ) : (
                      order.tiers && (
                        <div className="order-meta-line">
                          <span>Tiers:</span> <strong>{order.tiers}</strong>
                        </div>
                      )
                    )}

                    {(order.shape || order.size) && (
                      <div className="order-meta-tags">
                        {order.shape && (
                          <span>
                            Shape: <strong>{order.shape}</strong>
                          </span>
                        )}
                        {order.size && (
                          <span>
                            Size: <strong>{order.size}</strong>
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                </div>

                <div className="money-grid">
                  <div>
                    <span className="money-label">Total</span>
                    <strong className="money-val">{formatUgx(order.totalPriceUgx)}</strong>
                  </div>
                  <div>
                    <span className="money-label">Paid</span>
                    <strong className="money-val">{formatUgx(order.amountPaidUgx)}</strong>
                  </div>
                  <div>
                    <span className="money-label">Balance</span>
                    <strong
                      className={`money-val ${
                        order.balanceUgx === 0 ? 'balance-zero' : 'balance-due'
                      }`}
                    >
                      {formatUgx(order.balanceUgx)}
                    </strong>
                  </div>
                </div>

                <div className="order-card-actions">
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={() => onEditOrder(order)}
                  >
                    View or Edit Order
                  </button>
                  <button
                    type="button"
                    className={`btn btn-sm ${isPickedUp ? 'btn-ghost' : 'btn-primary'}`}
                    onClick={() => setPendingToggle({ order, nextStatus })}
                  >
                    {isPickedUp ? 'Mark Waiting Again' : 'Mark Picked Up'}
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      )}

      <ConfirmModal
        open={Boolean(pendingToggle)}
        title={
          pendingToggle?.nextStatus === 'picked_up'
            ? 'Confirm Cake Picked Up'
            : 'Return Order to Waiting'
        }
        message={
          pendingToggle
            ? pendingToggle.nextStatus === 'picked_up'
              ? `Mark order ${pendingToggle.order.orderId} for ${pendingToggle.order.customerName} as Picked up?${
                  pendingToggle.order.balanceUgx > 0
                    ? ` Outstanding balance: ${formatUgx(pendingToggle.order.balanceUgx)}.`
                    : ''
                }`
              : `Mark order ${pendingToggle.order.orderId} for ${pendingToggle.order.customerName} as Waiting for pickup again?`
            : ''
        }
        confirmLabel={
          pendingToggle?.nextStatus === 'picked_up' ? 'Yes, Mark Picked Up' : 'Yes, Mark Waiting'
        }
        busy={toggling}
        onConfirm={handleConfirmToggle}
        onCancel={() => setPendingToggle(null)}
      />
    </section>
  );
};
