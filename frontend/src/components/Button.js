import React from 'react';
import { buttonStyles, btnSmall, btnMedium, btnLarge } from '../styles/shared';

/**
 * Reusable button component.
 * @param {'green'|'red'|'blue'|'amber'|'purple'|'gray'|'darkRed'} variant
 * @param {'small'|'medium'|'large'} size
 */
export default function Button({
  variant = 'green',
  size = 'medium',
  onClick,
  type = 'button',
  children,
  style = {},
  disabled = false,
  ...rest
}) {
  const sizeStyle =
    size === 'small' ? btnSmall :
    size === 'large' ? btnLarge :
    btnMedium;

  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      style={{
        ...buttonStyles[variant],
        ...sizeStyle,
        ...style,
        ...(disabled ? { opacity: 0.5, cursor: 'not-allowed' } : {}),
      }}
      {...rest}
    >
      {children}
    </button>
  );
}
