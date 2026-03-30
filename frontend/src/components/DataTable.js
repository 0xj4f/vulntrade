import React from 'react';
import {
  tableStyle, tableSmall,
  thStyle, thStyleSmall,
  trBorder, trBorderMedium, trBorderHeavy,
  colors,
} from '../styles/shared';

/**
 * Reusable data table with column definitions.
 *
 * @param {Array<{key, label, align, render, headerStyle, cellStyle}>} columns
 * @param {Array<object>} data
 * @param {function} rowKey - (row, index) => unique key
 * @param {string} emptyText
 * @param {boolean} small - use smaller font size
 * @param {string} maxHeight - scrollable container height
 * @param {'default'|'medium'|'heavy'} headerBorder
 */
export default function DataTable({
  columns = [],
  data = [],
  rowKey,
  emptyText = 'No data',
  small = false,
  maxHeight,
  headerBorder = 'default',
}) {
  const tStyle = small ? tableSmall : tableStyle;
  const thFn = small ? thStyleSmall : thStyle;
  const hBorder =
    headerBorder === 'heavy' ? trBorderHeavy :
    headerBorder === 'medium' ? trBorderMedium :
    trBorderMedium;

  const table = (
    <table style={tStyle}>
      <thead>
        <tr style={hBorder}>
          {columns.map((col, i) => (
            <th key={i} style={{ ...thFn(col.align || 'left'), ...col.headerStyle }}>
              {col.label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {data.length > 0 ? data.map((row, i) => (
          <tr key={rowKey ? rowKey(row, i) : i} style={trBorder}>
            {columns.map((col, j) => (
              <td
                key={j}
                style={{
                  padding: small ? '6px' : '8px',
                  textAlign: col.align || 'left',
                  ...col.cellStyle,
                }}
              >
                {col.render ? col.render(row, i) : row[col.key]}
              </td>
            ))}
          </tr>
        )) : (
          <tr>
            <td
              colSpan={columns.length}
              style={{ padding: '16px', textAlign: 'center', color: colors.textDim }}
            >
              {emptyText}
            </td>
          </tr>
        )}
      </tbody>
    </table>
  );

  if (maxHeight) {
    return <div style={{ maxHeight, overflow: 'auto' }}>{table}</div>;
  }
  return table;
}
