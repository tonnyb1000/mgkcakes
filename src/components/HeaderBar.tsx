import React from 'react';
import type { StaffUser } from '../types/order';

export type ActiveTab = 'home' | 'orders' | 'new' | 'collections' | 'archive';

interface HeaderBarProps {
  configured: boolean;
  user: StaffUser | null;
  activeTab: ActiveTab;
  onTabChange: (tab: ActiveTab) => void;
  onSignOut: () => void;
}

export const HeaderBar: React.FC<HeaderBarProps> = ({
  configured,
  user,
  activeTab,
  onTabChange,
  onSignOut,
}) => {
  return (
    <header className="app-header">
      <div className="header-top">
        <div className="brand-block">
          <h1 className="app-title">Cake Order Tracker</h1>
          <span
            className={`mode-badge ${configured ? 'mode-live' : 'mode-unconfigured'}`}
            title={
              configured
                ? 'Connected to Firebase Authentication & Cloud Firestore.'
                : 'Firebase is not configured. Access is blocked until setup is complete.'
            }
          >
            {configured ? 'Firebase Connected' : 'Setup Required'}
          </span>
        </div>

        {user && (
          <div className="user-bar">
            <span className="user-chip">
              <span className="user-name">{user.displayName}</span>
              <span className={`role-pill role-${user.role}`}>{user.role}</span>
            </span>
            <button type="button" className="btn btn-ghost btn-sm" onClick={onSignOut}>
              Sign out
            </button>
          </div>
        )}
      </div>

      {user && activeTab !== 'home' && (
        <nav className="app-nav" aria-label="Primary navigation">
          <button type="button" className="nav-tab" onClick={() => onTabChange('home')}>
            &larr; Home
          </button>
          <button
            type="button"
            className={`nav-tab ${activeTab === 'orders' ? 'active' : ''}`}
            onClick={() => onTabChange('orders')}
          >
            View Orders
          </button>
          <button
            type="button"
            className={`nav-tab ${activeTab === 'new' ? 'active' : ''}`}
            onClick={() => onTabChange('new')}
          >
            New Order
          </button>
          <button
            type="button"
            className={`nav-tab ${activeTab === 'collections' ? 'active' : ''}`}
            onClick={() => onTabChange('collections')}
          >
            Daily Collections
          </button>
        </nav>
      )}
    </header>
  );
};
