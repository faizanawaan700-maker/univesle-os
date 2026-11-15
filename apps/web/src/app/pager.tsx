"use client";

import { useState, useCallback } from "react";

type PagerProps = {
  pageIndex: number;
  hasMore: boolean;
  disabled: boolean;
  onPrevious: () => void;
  onNext: () => void;
}

/** Pagination controls for Phase 3 cursor-paginated list endpoints. */
export default function Pager({ pageIndex, hasMore, disabled, onPrevious, onNext }: PagerProps) {
  return (
    <div className="pager">
      <button
        className="button secondary-button small"
        onClick={onPrevious}
        disabled={pageIndex <= 0 || disabled}
        aria-label="Previous page"
      >
        Previous
      </button>
      {hasMore && !disabled && (
        <button
          className="button secondary-button small"
          onClick={onNext}
          aria-label="Next page"
        >
          Next
        </button>
      )}
      {!hasMore && (
        <span className="pager-disabled" aria-live="polite">
          No more pages
        </span>
      )}
    </div>
  );
}