SELECT
  (SELECT COUNT(*) FROM "Organization") AS orgs,
  (SELECT COUNT(*) FROM "User") AS users,
  (SELECT COUNT(*) FROM "Sale") AS sales,
  (SELECT COUNT(*) FROM "Payment") AS payments,
  (SELECT COUNT(*) FROM "StockMovement") AS movements,
  (SELECT COALESCE(SUM("total"), 0) FROM "Sale") AS sales_total,
  (SELECT COUNT(*) FROM "_prisma_migrations" WHERE finished_at IS NOT NULL) AS migrations,
  (SELECT COUNT(*) FROM "JournalEntry") AS journals,
  (SELECT COALESCE(SUM("debit"), 0) FROM "JournalEntryLine") AS debits,
  (SELECT COALESCE(SUM("credit"), 0) FROM "JournalEntryLine") AS credits,
  (SELECT COUNT(*) FROM "OutboundEvent") AS outbound_events,
  (SELECT COUNT(*) FROM "IntegrationEvent") AS integration_events;
