import React from 'react';
import { inputStyle, labelStyle, formLabel } from '../styles/shared';

/**
 * Labeled form field wrapping an input.
 * @param {string} label - field label text
 * @param {'small'|'form'} labelVariant - 'small' uses 12px muted, 'form' uses 14px secondary
 * @param {string} width - input width override
 */
export default function FormField({
  label,
  labelVariant = 'small',
  width,
  children,
  style = {},
}) {
  const lbl = labelVariant === 'form' ? formLabel : labelStyle;

  return (
    <div style={{ marginBottom: '4px', ...style }}>
      {label && <label style={lbl}>{label}</label>}
      {children || (
        <input style={{ ...inputStyle, ...(width ? { width } : {}) }} />
      )}
    </div>
  );
}

/**
 * Standalone input with shared styling.
 * Forwards all standard input props.
 */
export function Input({ width, style = {}, ...props }) {
  return (
    <input
      style={{
        ...inputStyle,
        ...(width ? { width } : {}),
        ...style,
      }}
      {...props}
    />
  );
}

/**
 * Full-width input (for auth forms).
 */
export function InputFull({ style = {}, ...props }) {
  return (
    <input
      style={{
        ...inputStyle,
        width: '100%',
        ...style,
      }}
      {...props}
    />
  );
}
