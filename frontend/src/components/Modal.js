import React from 'react';
import { modalOverlay, modalContent } from '../styles/shared';

/**
 * Reusable modal overlay with centered content.
 * @param {boolean} open - whether to render
 * @param {function} onClose - called on overlay click
 * @param {string} width - content width
 */
export default function Modal({ open, onClose, width = '400px', children }) {
  if (!open) return null;

  return (
    <div style={modalOverlay} onClick={onClose}>
      <div style={modalContent(width)} onClick={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>
  );
}
