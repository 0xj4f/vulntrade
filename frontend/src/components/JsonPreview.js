import React, { useState } from 'react';
import { preBlock, colors } from '../styles/shared';

/**
 * Styled JSON/code preview block with copy button.
 */
export default function JsonPreview({ data, style = {} }) {
  const [copied, setCopied] = useState(false);

  if (!data) return null;

  const text = typeof data === 'string' ? data : JSON.stringify(data, null, 2);

  const handleCopy = () => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <div style={{ position: 'relative', marginTop: '12px' }}>
      <button
        onClick={handleCopy}
        style={{
          position: 'absolute',
          top: '8px',
          right: '8px',
          background: colors.borderMedium,
          border: 'none',
          color: colors.textMuted,
          padding: '4px 10px',
          borderRadius: '6px',
          cursor: 'pointer',
          fontSize: '11px',
          fontWeight: '500',
        }}
      >
        {copied ? '✓ Copied' : 'Copy'}
      </button>
      <pre style={{ ...preBlock, marginTop: 0, ...style }}>
        {text}
      </pre>
    </div>
  );
}
