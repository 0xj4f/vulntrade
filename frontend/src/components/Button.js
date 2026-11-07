import React from 'react';
import { Loader2 } from 'lucide-react';
import { buttonStyles, btnSmall, btnMedium, btnLarge } from '../styles/shared';

const SIZES = { small: btnSmall, medium: btnMedium, large: btnLarge };

/**
 * Button. variant: green | red | blue | amber | purple | gray | ghost | darkRed
 * `loading` disables it and shows a spinner; `icon` renders before the label.
 */
export default function Button({
  variant = 'blue', size = 'medium', children, style = {}, loading = false, icon,
  disabled, type = 'button', className = '', ...props
}) {
  return (
    <button
      type={type}
      className={`vt-btn${variant === 'ghost' || variant === 'gray' ? ' vt-ghost' : ''} ${className}`}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      style={{ ...(buttonStyles[variant] || buttonStyles.blue), ...(SIZES[size] || btnMedium), ...style }}
      {...props}
    >
      {loading ? <Loader2 size={14} aria-hidden="true" style={{ animation: 'spin 0.8s linear infinite' }} /> : icon}
      {children}
    </button>
  );
}
