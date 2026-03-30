import React from 'react';
import { preBlock } from '../styles/shared';

/**
 * Styled JSON/code preview block.
 */
export default function JsonPreview({ data, style = {} }) {
  if (!data) return null;
  return (
    <pre style={{ ...preBlock, ...style }}>
      {typeof data === 'string' ? data : JSON.stringify(data, null, 2)}
    </pre>
  );
}
