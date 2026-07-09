import type { ReactNode } from "react";

export interface TableColumn<T> {
  key: string;
  header: ReactNode;
  cell: (row: T) => ReactNode;
  className?: string;
}

export interface TableProps<T> {
  columns: TableColumn<T>[];
  rows: T[];
  getRowKey: (row: T, index: number) => string;
  empty?: ReactNode;
  minWidth?: string;
  className?: string;
}

export function Table<T>({
  columns,
  rows,
  getRowKey,
  empty,
  minWidth = "760px",
  className = "",
}: TableProps<T>) {
  return (
    <div className={`overflow-x-auto rounded-[var(--radius-4)] bg-[var(--surface)] shadow-[var(--shadow)] ${className}`.trim()}>
      <table className="w-full border-separate border-spacing-0 text-left text-[var(--font-size-sm)]" style={{ minWidth }}>
        <thead className="text-[var(--font-size-xs)] text-[var(--mutedfg)]">
          <tr>
            {columns.map((column) => (
              <th key={column.key} className={`px-[var(--space-3)] py-[var(--space-2)] font-medium ${column.className ?? ""}`.trim()}>
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={columns.length} className="px-[var(--space-3)] py-[var(--space-5)]">
                {empty}
              </td>
            </tr>
          ) : (
            rows.map((row, index) => (
              <tr key={getRowKey(row, index)} className="align-top odd:bg-[var(--raised)] even:bg-[var(--surface)] hover:bg-[var(--hover)]">
                {columns.map((column) => (
                  <td key={column.key} className={`border-t border-[var(--border)] px-[var(--space-3)] py-[var(--space-2)] ${column.className ?? ""}`.trim()}>
                    {column.cell(row)}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
