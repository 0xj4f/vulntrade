import React, { useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { colors, preBlock } from '../styles/shared';

/** JSON/code block with a copy button. */
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
      <button type="button" onClick={handleCopy} className="vt-btn vt-ghost" aria-label="Copy to clipboard"
        style={{ position: 'absolute', top: '8px', right: '8px', display: 'inline-flex', alignItems: 'center', gap: '4px', background: colors.bgRaised, border: `1px solid ${colors.borderDefault}`, color: colors.textSecondary, padding: '3px 8px', borderRadius: '6px', fontSize: '11px', fontWeight: 500 }}>
        {copied ? <Check size={12} aria-hidden="true" /> : <Copy size={12} aria-hidden="true" />}
        {copied ? 'Copied' : 'Copy'}
      </button>
      <pre style={{ ...preBlock, marginTop: 0, ...style }}>{text}</pre>
    </div>
  );
}
