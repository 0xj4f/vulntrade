import React, { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { colors, modalOverlay, modalContent, type } from '../styles/shared';

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Dialog: Esc and backdrop close it, focus is trapped inside and restored on close.
 */
export default function Modal({ open, onClose, width = '440px', title, children, footer }) {
  const panelRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const previous = document.activeElement;
    const panel = panelRef.current;
    const first = panel && panel.querySelector(FOCUSABLE);
    (first || panel)?.focus();

    const onKey = (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); onClose && onClose(); return; }
      if (e.key !== 'Tab' || !panel) return;
      const items = Array.from(panel.querySelectorAll(FOCUSABLE));
      if (items.length === 0) return;
      const firstEl = items[0], lastEl = items[items.length - 1];
      if (e.shiftKey && document.activeElement === firstEl) { e.preventDefault(); lastEl.focus(); }
      else if (!e.shiftKey && document.activeElement === lastEl) { e.preventDefault(); firstEl.focus(); }
    };
    document.addEventListener('keydown', onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
      if (previous && previous.focus) previous.focus();
    };
  }, [open, onClose]);

  if (!open) return null;

  // Portal to <body> so no transformed/animated ancestor can trap the fixed overlay.
  return createPortal(
    <div style={modalOverlay} onMouseDown={(e) => { if (e.target === e.currentTarget) onClose && onClose(); }}>
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={typeof title === 'string' ? title : undefined}
        tabIndex={-1}
        className="vt-pop"
        style={modalContent(width)}
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Close dialog"
          className="vt-btn vt-ghost"
          style={{
            position: 'absolute', top: '12px', right: '12px', width: '32px', height: '32px',
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            background: 'transparent', border: 'none', borderRadius: '8px', color: colors.textMuted,
          }}
        >
          <X size={18} aria-hidden="true" />
        </button>
        {title && <h2 style={{ ...type.title, fontSize: '18px', marginBottom: '16px', paddingRight: '36px' }}>{title}</h2>}
        {children}
        {footer && <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', marginTop: '20px' }}>{footer}</div>}
      </div>
    </div>,
    document.body
  );
}
