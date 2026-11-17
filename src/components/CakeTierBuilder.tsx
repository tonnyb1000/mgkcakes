import React from 'react';
import type { CakeTierDetail } from '../types/order';
import {
  calculateTiersTotalUgx,
  formatUgx,
  QUICK_TIER_PRICES_UGX,
} from '../utils/currency';

const SHAPE_OPTIONS = ['Round', 'Square', 'Heart', 'Rectangle', 'Hexagon'] as const;

interface CakeTierBuilderProps {
  tiers: CakeTierDetail[];
  onChange: (nextTiers: CakeTierDetail[]) => void;
  error?: string;
}

export const CakeTierBuilder: React.FC<CakeTierBuilderProps> = ({
  tiers,
  onChange,
  error,
}) => {
  const totalUgx = calculateTiersTotalUgx(tiers);

  // Stack visually from top (smallest = highest tierNumber) down to bottom (largest = tier 1).
  const topToBottom = [...tiers].sort((a, b) => b.tierNumber - a.tierNumber);

  const handleAddTier = () => {
    const nextNumber = tiers.length + 1;
    onChange([
      ...tiers,
      {
        tierNumber: nextNumber,
        shape: 'Round',
        priceUgx: 0,
      },
    ]);
  };

  const handleRemoveTier = (tierNumber: number) => {
    if (tiers.length <= 1) return;
    const remaining = tiers
      .filter((t) => t.tierNumber !== tierNumber)
      .map((t, idx) => ({ ...t, tierNumber: idx + 1 }));
    onChange(remaining);
  };

  const updateTier = (tierNumber: number, patch: Partial<CakeTierDetail>) => {
    onChange(
      tiers.map((t) => (t.tierNumber === tierNumber ? { ...t, ...patch } : t))
    );
  };

  const getCylinderWidthPercent = (tierNumber: number, count: number): number => {
    if (count <= 1) return 82;
    // Tier 1 (bottom) is widest (96%), top tier is narrowest (down to ~46%).
    const step = 48 / Math.max(1, count - 1);
    return Math.round(96 - (tierNumber - 1) * step);
  };

  const getTierPositionLabel = (tierNumber: number, count: number): string => {
    if (count === 1) return 'Tier 1';
    if (tierNumber === 1) return 'Tier 1 (Bottom)';
    if (tierNumber === count) return `Tier ${tierNumber} (Top)`;
    return `Tier ${tierNumber}`;
  };

  return (
    <div className="tier-builder" aria-label="Cake tier builder">
      <div className="tier-builder-header">
        <div>
          <span className="tier-builder-title">Cake Tiers &amp; Pricing</span>
          <p className="help-text">
            Add one or more tiers. Smaller tiers stack on top. Quick prices do not assume physical
            size.
          </p>
        </div>
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          onClick={handleAddTier}
          disabled={tiers.length >= 10}
        >
          + Add Tier
        </button>
      </div>

      {/* Visual Cylinder Preview (Top = smaller, Bottom = larger) with price beside each tier */}
      <div className="tier-preview-box" aria-label="Cake tier cylinder preview">
        {topToBottom.map((tier) => {
          const widthPct = getCylinderWidthPercent(tier.tierNumber, tiers.length);
          return (
            <div key={tier.tierNumber} className="tier-preview-row">
              <div className="tier-cylinder-stage">
                <div
                  className="tier-cylinder"
                  style={{ width: `${widthPct}%` }}
                  aria-hidden="true"
                >
                  <div className="tier-cylinder-top" />
                  <div className="tier-cylinder-body">
                    <span className="tier-cylinder-label">T{tier.tierNumber}</span>
                  </div>
                </div>
              </div>
              <div className="tier-preview-meta">
                <span className="tier-preview-name">
                  {getTierPositionLabel(tier.tierNumber, tiers.length)} &middot;{' '}
                  {tier.shape || 'Round'}
                </span>
                <strong className="tier-preview-price">{formatUgx(tier.priceUgx)}</strong>
              </div>
            </div>
          );
        })}

        <div className="tier-preview-total">
          <span>Cake Total ({tiers.length} {tiers.length === 1 ? 'tier' : 'tiers'})</span>
          <strong>{formatUgx(totalUgx)}</strong>
        </div>
      </div>

      {error && <span className="field-error">{error}</span>}

      {/* Tier Editors (Top to Bottom to match visual stack) */}
      <div className="tier-editors">
        {topToBottom.map((tier) => {
          const isStandardShape = (SHAPE_OPTIONS as readonly string[]).includes(tier.shape);
          return (
            <div key={tier.tierNumber} className="tier-editor-card">
              <div className="tier-editor-top">
                <strong>{getTierPositionLabel(tier.tierNumber, tiers.length)}</strong>
                {tiers.length > 1 && (
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => handleRemoveTier(tier.tierNumber)}
                  >
                    Remove
                  </button>
                )}
              </div>

              <div className="grid-2">
                <div className="field">
                  <label htmlFor={`tier-shape-${tier.tierNumber}`}>Shape</label>
                  <select
                    id={`tier-shape-${tier.tierNumber}`}
                    value={isStandardShape ? tier.shape : 'Custom'}
                    onChange={(e) => {
                      const val = e.target.value;
                      updateTier(tier.tierNumber, {
                        shape: val === 'Custom' ? '' : val,
                      });
                    }}
                  >
                    {SHAPE_OPTIONS.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                    <option value="Custom">Other / Custom</option>
                  </select>
                  {!isStandardShape && (
                    <input
                      type="text"
                      aria-label={`Custom shape for Tier ${tier.tierNumber}`}
                      value={tier.shape}
                      onChange={(e) => updateTier(tier.tierNumber, { shape: e.target.value })}
                      placeholder="Enter custom shape"
                    />
                  )}
                </div>

                <div className="field">
                  <label htmlFor={`tier-price-${tier.tierNumber}`}>Tier Price (UGX)</label>
                  <input
                    id={`tier-price-${tier.tierNumber}`}
                    type="number"
                    min={0}
                    step={500}
                    value={tier.priceUgx}
                    onChange={(e) => {
                      const raw = e.target.value;
                      const parsed = raw === '' ? 0 : Number(raw);
                      updateTier(tier.tierNumber, {
                        priceUgx: Number.isNaN(parsed) ? 0 : Math.max(0, parsed),
                      });
                    }}
                  />
                </div>
              </div>

              <div
                className="quick-price-chips"
                role="group"
                aria-label={`Quick prices for Tier ${tier.tierNumber}`}
              >
                {QUICK_TIER_PRICES_UGX.map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    className={`price-chip ${tier.priceUgx === preset ? 'active' : ''}`}
                    onClick={() => updateTier(tier.tierNumber, { priceUgx: preset })}
                  >
                    {new Intl.NumberFormat('en-US').format(preset)}
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
