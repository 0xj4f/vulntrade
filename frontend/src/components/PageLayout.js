import React from 'react';
import { pageContainer, pageHeading, colors } from '../styles/shared';

/**
 * Standard page wrapper with heading.
 * @param {string} title - page heading
 * @param {string} titleColor - heading color
 * @param {string} maxWidth - container max width
 */
export default function PageLayout({ title, titleColor, maxWidth = '1200px', children }) {
  return (
    <div style={{
      ...pageContainer(maxWidth),
      minHeight: 'calc(100vh - 56px)',
      background: `linear-gradient(180deg, ${colors.bgPage} 0%, #0F1D32 100%)`,
    }}>
      {title && <h2 style={pageHeading(titleColor)}>{title}</h2>}
      {children}
    </div>
  );
}
