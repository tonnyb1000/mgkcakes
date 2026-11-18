import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AuthScreen } from './components/AuthScreen';
import { ArchivePage } from './components/ArchivePage';
import { ConfirmModal } from './components/ConfirmModal';
import { HeaderBar, type ActiveTab } from './components/HeaderBar';
import { clearPendingNewOrderDraft } from './components/OrderForm';
import { OrderForm } from './components/OrderForm';
import { OrdersPage } from './components/OrdersPage';
import { SalesCollectionsPage } from './components/SalesCollectionsPage';
import { createOrderRepository, type OrderRepository } from './services/orderRepository';
import type {
  CakeOrder,
  CakeOrderInput,
  CashFlowEntry,
  CashFlowEntryInput,
  PaymentMethod,
  PaymentTransaction,
  PickupStatus,
  StaffUser,
  WalkInSaleInput,
} from './types/order';

interface AppProps {
  repository?: OrderRepository;
}

export const App: React.FC<AppProps> = ({ repository: injectedRepo }) => {
  const repo = useMemo(() => injectedRepo ?? createOrderRepository(), [injectedRepo]);

  const [user, setUser] = useState<StaffUser | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  const [activeTab, setActiveTab] = useState<ActiveTab>('home');
  const [editingOrder, setEditingOrder] = useState<CakeOrder | null>(null);
  const [editingDirty, setEditingDirty] = useState(false);
  const [pendingNavAction, setPendingNavAction] = useState<(() => void) | null>(null);

  const [orders, setOrders] = useState<CakeOrder[]>([]);
  const [payments, setPayments] = useState<PaymentTransaction[]>([]);
  const [cashFlowEntries, setCashFlowEntries] = useState<CashFlowEntry[]>([]);
  const [dataLoading, setDataLoading] = useState(false);
  const [dataError, setDataError] = useState<string | null>(null);
  const [bannerMessage, setBannerMessage] = useState<string | null>(null);

  useEffect(() => {
    const unsubscribe = repo.subscribeAuth((nextUser, err) => {
      setUser(nextUser);
      setAuthError(err ?? null);
      setAuthReady(true);
    });
    return unsubscribe;
  }, [repo]);

  const loadData = useCallback(async () => {
    if (!user || !repo.configured) {
      setOrders([]);
      setPayments([]);
      setCashFlowEntries([]);
      return;
    }
    setDataLoading(true);
    setDataError(null);
    try {
      const [orderList, paymentList, cashFlowList] = await Promise.all([
        repo.listOrders(user),
        repo.listPayments(user),
        repo.listCashFlowEntries(user),
      ]);
      setOrders(orderList);
      setPayments(paymentList);
      setCashFlowEntries(cashFlowList);
    } catch (err) {
      setDataError(err instanceof Error ? err.message : 'Failed to load data.');
    } finally {
      setDataLoading(false);
    }
  }, [repo, user]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const handleSignIn = async (email: string, password: string) => {
    setAuthError(null);
    await repo.signIn(email, password);
  };

  const performSignOut = async () => {
    clearPendingNewOrderDraft();
    await repo.signOut();
    setEditingOrder(null);
    setEditingDirty(false);
    setActiveTab('home');
    setBannerMessage(null);
  };

  const handleSignOut = async () => {
    if (editingOrder && editingDirty) {
      setPendingNavAction(() => () => {
        void performSignOut();
      });
      return;
    }
    await performSignOut();
  };

  const handleSaveOrder = async (
    input: CakeOrderInput,
    orderId?: string,
    newOrderIdempotency?: { orderId: string; paymentId: string },
    expectedUpdatedAt?: string
  ) => {
    if (orderId) {
      const updated = await repo.updateOrder(orderId, input, user, expectedUpdatedAt);
      setOrders((prev) =>
        prev.some((o) => o.orderId === orderId)
          ? prev.map((o) => (o.orderId === orderId ? updated : o))
          : [updated, ...prev]
      );
      if (updated.amountPaidUgx > 0) {
        const latestPayments = await repo.listPayments(user);
        setPayments(latestPayments);
      }
      setEditingOrder(null);
      setEditingDirty(false);
      setActiveTab('orders');
      setBannerMessage(`Order ${updated.orderId} updated.`);
    } else {
      const created = await repo.createOrder(input, user, newOrderIdempotency);
      setOrders((prev) =>
        prev.some((o) => o.orderId === created.orderId)
          ? prev.map((o) => (o.orderId === created.orderId ? created : o))
          : [created, ...prev]
      );
      if (created.amountPaidUgx > 0) {
        const latestPayments = await repo.listPayments(user);
        setPayments(latestPayments);
      }
      setActiveTab('orders');
      setBannerMessage(`Order ${created.orderId} saved for ${created.customerName}.`);
    }
  };

  const handleRecordOrderPayment = async (
    orderId: string,
    amountUgx: number,
    idempotencyPaymentId: string,
    paymentMethod: PaymentMethod
  ) => {
    const { order: updatedOrder, payment } = await repo.recordOrderPayment(
      orderId,
      amountUgx,
      user,
      idempotencyPaymentId,
      paymentMethod
    );
    setOrders((prev) => prev.map((o) => (o.orderId === orderId ? updatedOrder : o)));
    setEditingOrder((prev) => (prev?.orderId === orderId ? updatedOrder : prev));
    setPayments((prev) => [payment, ...prev]);
  };

  const handleRecordWalkInSale = async (
    input: WalkInSaleInput,
    idempotencyPaymentId: string
  ) => {
    const sale = await repo.recordWalkInSale(input, user, idempotencyPaymentId);
    setPayments((prev) => [sale, ...prev]);
    setBannerMessage(`Walk-in sale recorded (${sale.description}).`);
  };

  const handleRecordCashFlowEntry = async (
    input: CashFlowEntryInput,
    idempotencyEntryId: string
  ) => {
    const entry = await repo.recordCashFlowEntry(input, user, idempotencyEntryId);
    setCashFlowEntries((prev) => [entry, ...prev]);
    setBannerMessage(
      `${entry.type === 'expense' ? 'Expense' : 'Other item sale'} recorded (${entry.description}).`
    );
  };

  const handleDeleteOrder = async (order: CakeOrder) => {
    const deleted = await repo.deleteOrder(order.orderId, user);
    setOrders((prev) => prev.map((o) => (o.orderId === order.orderId ? deleted : o)));
    setBannerMessage(
      `Order ${deleted.orderId} deleted. Payment records are retained for history and excluded from daily totals.`
    );
  };

  const handleTogglePickupStatus = async (order: CakeOrder, nextStatus: PickupStatus) => {
    const updated = await repo.updatePickupStatus(order.orderId, nextStatus, user);
    setOrders((prev) => prev.map((o) => (o.orderId === order.orderId ? updated : o)));
    setBannerMessage(
      `Order ${updated.orderId} marked as ${
        updated.pickupStatus === 'picked_up' ? 'Picked up' : 'Waiting for pickup'
      }.`
    );
  };

  const handleDeleteArchived = async (orderIds: string[]): Promise<number> => {
    const count = await repo.deleteArchivedOrders(orderIds, user);
    const idSet = new Set(orderIds);
    setOrders((prev) => prev.filter((o) => !idSet.has(o.orderId)));
    return count;
  };

  const handleTabChange = (tab: ActiveTab) => {
    if (editingOrder && editingDirty) {
      setPendingNavAction(() => () => {
        setEditingOrder(null);
        setEditingDirty(false);
        setBannerMessage(null);
        setActiveTab(tab);
      });
      return;
    }
    setEditingOrder(null);
    setEditingDirty(false);
    setBannerMessage(null);
    setActiveTab(tab);
  };

  const editingOrderPayments = useMemo(
    () =>
      editingOrder
        ? payments.filter((p) => p.orderId === editingOrder.orderId)
        : [],
    [editingOrder, payments]
  );

  return (
    <div className="app-shell">
      <HeaderBar
        configured={repo.configured}
        user={repo.configured ? user : null}
        activeTab={editingOrder ? 'orders' : activeTab}
        onTabChange={handleTabChange}
        onSignOut={handleSignOut}
      />

      {!repo.configured ? (
        <AuthScreen configured={false} authError={null} onSignIn={handleSignIn} />
      ) : !authReady ? (
        <main className="main-content">
          <div className="card state-card" role="status">
            Checking staff session…
          </div>
        </main>
      ) : !user ? (
        <AuthScreen configured authError={authError} onSignIn={handleSignIn} />
      ) : (
        <main className="main-content">
          {bannerMessage && (
            <div className="notice notice-success banner-dismiss" role="status">
              <span>{bannerMessage}</span>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => setBannerMessage(null)}
                aria-label="Dismiss message"
              >
                Dismiss
              </button>
            </div>
          )}

          {editingOrder ? (
            <OrderForm
              key={editingOrder.orderId}
              existingOrder={editingOrder}
              orderPayments={editingOrderPayments}
              onSave={handleSaveOrder}
              onReloadExistingOrder={(latest) => {
                setOrders((prev) =>
                  prev.map((o) => (o.orderId === latest.orderId ? latest : o))
                );
                setEditingOrder(latest);
              }}
              onDirtyChange={setEditingDirty}
              onRecordPayment={handleRecordOrderPayment}
              onCancel={() => {
                setEditingOrder(null);
                setEditingDirty(false);
              }}
            />
          ) : activeTab === 'new' ? (
            <OrderForm
              onSave={handleSaveOrder}
              onCheckExistingOrder={(orderId) => repo.getOrderById(orderId, user)}
              onResolveKeepSaved={async (savedOrder) => {
                setOrders((prev) =>
                  prev.some((o) => o.orderId === savedOrder.orderId)
                    ? prev.map((o) => (o.orderId === savedOrder.orderId ? savedOrder : o))
                    : [savedOrder, ...prev]
                );
                if (savedOrder.amountPaidUgx > 0) {
                  const latestPayments = await repo.listPayments(user);
                  setPayments(latestPayments);
                }
                setActiveTab('orders');
                setBannerMessage(`Reconciled existing order ${savedOrder.orderId}.`);
              }}
              onCancel={() => handleTabChange('orders')}
            />
          ) : activeTab === 'collections' ? (
            <SalesCollectionsPage
              orders={orders}
              payments={payments}
              cashFlowEntries={cashFlowEntries}
              user={user}
              loading={dataLoading}
              error={dataError}
              onRefresh={loadData}
              onRecordWalkInSale={handleRecordWalkInSale}
              onRecordCashFlowEntry={handleRecordCashFlowEntry}
            />
          ) : activeTab === 'archive' ? (
            <ArchivePage
              orders={orders}
              user={user}
              onDeleteArchivedOrders={handleDeleteArchived}
            />
          ) : activeTab === 'orders' ? (
            <OrdersPage
              orders={orders}
              payments={payments}
              user={user}
              loading={dataLoading}
              error={dataError}
              onRefresh={loadData}
              onEditOrder={(order) => {
                setBannerMessage(null);
                setEditingOrder(order);
              }}
              onTogglePickupStatus={handleTogglePickupStatus}
              onDeleteOrder={handleDeleteOrder}
              onCreateNew={() => handleTabChange('new')}
            />
          ) : (
            <section className="stack-lg" aria-labelledby="home-heading">
              <div className="home-intro">
                <h2 id="home-heading" className="section-title">
                  What would you like to do?
                </h2>
              </div>

              <div className="home-actions">
                <button
                  type="button"
                  className="home-action-card home-action-primary"
                  onClick={() => handleTabChange('new')}
                >
                  <span className="home-action-title">New Order</span>
                  <span className="home-action-sub">
                    Record customer, cake details, pickup date, and deposit
                  </span>
                </button>

                <button
                  type="button"
                  className="home-action-card"
                  onClick={() => handleTabChange('orders')}
                >
                  <span className="home-action-title">View Orders</span>
                  <span className="home-action-sub">
                    Search orders, check today&apos;s pickups, and update payments
                  </span>
                </button>
              </div>

              <div className="card">
                <div className="owner-tools-row">
                  <div>
                    <h3 className="owner-tools-title">Sales &amp; Daily Collections</h3>
                    <p className="help-text">
                      Record walk-in cake sales and view money received today (deposits, balance
                      payments, and walk-ins).
                    </p>
                  </div>
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={() => handleTabChange('collections')}
                  >
                    Daily Collections
                  </button>
                </div>
              </div>

              {(user.role === 'owner' || user.role === 'admin') && (
                <div className="card owner-tools-card">
                  <div className="owner-tools-row">
                    <div>
                      <h3 className="owner-tools-title">Owner Tools: Archive &amp; CSV</h3>
                      <p className="help-text">
                        Export older orders to Excel CSV and manage 12-month archive backups.
                      </p>
                    </div>
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      onClick={() => handleTabChange('archive')}
                    >
                      Archive &amp; CSV
                    </button>
                  </div>
                </div>
              )}
            </section>
          )}

          <ConfirmModal
            open={Boolean(pendingNavAction)}
            title="Discard Unsaved Edits?"
            message={`You have unsaved changes to order ${editingOrder?.orderId ?? ''}. Leave without saving?`}
            confirmLabel="Discard Changes"
            cancelLabel="Stay on Order"
            danger
            onConfirm={() => {
              const action = pendingNavAction;
              setPendingNavAction(null);
              action?.();
            }}
            onCancel={() => setPendingNavAction(null)}
          />
        </main>
      )}
    </div>
  );
};

export default App;
