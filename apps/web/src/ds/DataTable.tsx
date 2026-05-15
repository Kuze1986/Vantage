import type { ReactNode } from 'react'
import './DataTable.css'

interface DataTableProps {
  columns: { key: string; label: string; width?: string }[]
  rows: Record<string, ReactNode>[]
  onRowClick?: (row: Record<string, ReactNode>) => void
}

export function DataTable({ columns, rows, onRowClick }: DataTableProps) {
  const clickable = typeof onRowClick === 'function'
  return (
    <div className="nx-data-table-wrap">
      <table className={`nx-data-table${clickable ? ' nx-data-table--clickable' : ''}`}>
        <thead>
          <tr>
            {columns.map((col) => (
              <th key={col.key} style={col.width ? { width: col.width } : undefined}>
                {col.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} onClick={clickable ? () => onRowClick?.(row) : undefined}>
              {columns.map((col) => (
                <td key={col.key}>{row[col.key]}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
