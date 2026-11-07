import React from 'react';
import { colors, num } from '../styles/shared';

/**
 * Config-driven table.
 *
 * columns: [{ key, label, align, render(row, i), width, mono, nowrap }]
 * Numeric columns (align: 'right') get tabular figures. The header sticks inside a
 * `maxHeight` scroll area; wide tables scroll horizontally inside their card.
 */
export default function DataTable({
  columns, data, rowKey, emptyText = 'No data', empty, small = false, maxHeight,
  onRowClick, rowStyle, rowClassName, style = {}, caption,
}) {
  const rows = data || [];
  return (
    <div className="vt-scroll-x" style={{ ...(maxHeight ? { maxHeight, overflowY: 'auto' } : {}), ...style }}>
      <table className={`vt-table${small ? ' dense' : ''}`}>
        {caption && <caption style={{ position: 'absolute', left: '-9999px' }}>{caption}</caption>}
        <thead>
          <tr>
            {columns.map(col => (
              <th key={col.key} scope="col" style={{ textAlign: col.align || 'left', width: col.width }}>{col.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={columns.length} style={{ padding: '28px 12px', textAlign: 'center', color: colors.textMuted }}>
                {empty || emptyText}
              </td>
            </tr>
          ) : rows.map((row, i) => (
            <tr
              key={rowKey ? rowKey(row, i) : i}
              className={`vt-row${onRowClick ? ' vt-row-click' : ''}${rowClassName ? ' ' + rowClassName(row, i) : ''}`}
              onClick={onRowClick ? () => onRowClick(row, i) : undefined}
              style={rowStyle ? rowStyle(row, i) : undefined}
            >
              {columns.map(col => (
                <td key={col.key} style={{
                  textAlign: col.align || 'left',
                  whiteSpace: col.nowrap || col.align === 'right' ? 'nowrap' : undefined,
                  ...(col.mono || col.align === 'right' ? num : {}),
                }}>
                  {col.render ? col.render(row, i) : (row[col.key] ?? '—')}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
