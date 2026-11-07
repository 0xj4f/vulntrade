import React, { useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { colors, inputFull } from '../styles/shared';

/** Password field with a show/hide toggle. Forwards all input props. */
export default function PasswordInput({ style = {}, ...props }) {
  const [show, setShow] = useState(false);
  return (
    <div style={{ position: 'relative' }}>
      <input {...props} type={show ? 'text' : 'password'} style={{ ...inputFull, paddingRight: '42px', ...style }} />
      <button type="button" onClick={() => setShow(s => !s)} aria-label={show ? 'Hide password' : 'Show password'} aria-pressed={show}
        style={{ position: 'absolute', right: '4px', top: '50%', transform: 'translateY(-50%)', width: '34px', height: '32px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', border: 'none', background: 'transparent', color: colors.textMuted, borderRadius: '6px' }}>
        {show ? <EyeOff size={16} aria-hidden="true" /> : <Eye size={16} aria-hidden="true" />}
      </button>
    </div>
  );
}
