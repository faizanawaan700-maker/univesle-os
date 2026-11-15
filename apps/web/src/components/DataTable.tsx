"use client";

import { PropsWithChildren, ReactNode } from "react";

type Column<T = unknown> = {
  key: string;
  header: string;
  align?: "left" | "right";
  className?: string;
};

type DataTableProps<T extends Record<string, unknown>> = {
  columns: Column<T>[];
  rows: T[];
  rowKey?: string;
  renderCell?: (
    value: unknown,
    row: T,
    column: Column<T>,
  ) => ReactNode;
  className?: string;
};

export default function DataTable<T extends Record<string, unknown>>({
  columns,
  rows,
  rowKey = "id",
  renderCell,
  className = "",
}: PropsWithChildren<DataTableProps<T>>) {
  if (rows.length === 0) {
    return (
      <div className="empty-state">
        <div className="empty-state-icon">📋</div>
        <h2>No data</h2>
        <p>No records match the current filters.</p>
      </div>
    );
  }

  return (
    <div className="table-wrap">
      <table className="data-table">
        <thead>
          <tr>
            {columns.map((column) => (
              <th
                key={column.key}
                style={{
                  textAlign: column.align ?? "left",
                }}
              >
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row: any) => (
            <tr key={row[rowKey]}>
              {columns.map((column) => {
                const value = row[column.key];
                const cellValue =
                  renderCell ? renderCell(value, row, column) : value;
                return (
                  <td
                    key={column.key}
                    className={column.className}
                    style={{
                      fontFamily:
                        column.align === "right"
                          ? "var(--font-mono)"
                          : undefined,
                    }}
                  >
                    {cellValue ?? ""}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}