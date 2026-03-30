import React from 'react';
import { modalOverlay, modalContent, colors } from '../styles/shared';

/**
 * Reusable modal overlay with centered content.
 * @param {boolean} open - whether to render
 * @param {function} onClose - called on overlay click
 * @param {string} width - content width
 */
export default function Modal({ open, onClose, width = '420px', children }) {
  if (!open) return null;

  return (
    <div style={modalOverlay} onClick={onClose}>
      <div style={modalContent(width)} onClick={(e) => e.stopPropagation()}>
        {onClose && (
          <button
            onClick={onClose}
            style={{
              position: 'absolute',
              top: '16px',
              right: '16px',
              background: 'none',
              border: 'none',
              color: colors.textMuted,
              fontSize: '18px',
              cursor: 'pointer',
              padding: '4px',
              lineHeight: 1,
            }}
          >
            ✕
          </button>
        )}
        <div style={{ position: 'relative' }}>
          {children}
        </div>
      </div>
    </div>
  );
}
