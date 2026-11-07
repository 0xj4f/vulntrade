import React, { useId } from 'react';
import { labelStyle, inputStyle, inputFull, colors } from '../styles/shared';

/**
 * Labelled form field. The label is tied to the first child input via htmlFor/id.
 */
export default function FormField({ label, hint, error, children, style = {}, grow = false }) {
  const autoId = useId();
  const child = React.Children.only(children);
  const id = child.props.id || autoId;
  const describedBy = error ? `${id}-err` : hint ? `${id}-hint` : undefined;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0, ...(grow ? { flex: 1 } : {}), ...style }}>
      {label && <label htmlFor={id} style={labelStyle}>{label}</label>}
      {React.cloneElement(child, { id, 'aria-describedby': describedBy, 'aria-invalid': error ? true : undefined })}
      {error && <span id={`${id}-err`} role="alert" style={{ color: colors.redLight, fontSize: '12px', marginTop: '6px' }}>{error}</span>}
      {!error && hint && <span id={`${id}-hint`} style={{ color: colors.textMuted, fontSize: '12px', marginTop: '6px' }}>{hint}</span>}
    </div>
  );
}

export function Input({ width, style = {}, ...props }) {
  return <input {...props} style={{ ...inputStyle, ...(width ? { width } : {}), ...style }} />;
}

export function InputFull({ style = {}, ...props }) {
  return <input {...props} style={{ ...inputFull, ...style }} />;
}
