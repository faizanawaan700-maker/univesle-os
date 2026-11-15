const dotenv = require("dotenv");
const { resolve } = require("node:path");

dotenv.config({ path: resolve(__dirname, "../../../packages/database/.env"), quiet: true });

const { database } = require("@ubos/database");

const QUERY = `
  SELECT relation, child_id, child_organization_id, parent_id, parent_organization_id
  FROM (
    SELECT 'Product.categoryId' AS relation, p."id" AS child_id,
      p."organizationId" AS child_organization_id, c."id" AS parent_id,
      c."organizationId" AS parent_organization_id
    FROM "Product" p JOIN "ProductCategory" c ON c."id" = p."categoryId"
    WHERE p."organizationId" <> c."organizationId"
    UNION ALL
    SELECT 'Inventory.productId', i."id", i."organizationId", p."id", p."organizationId"
    FROM "Inventory" i JOIN "Product" p ON p."id" = i."productId"
    WHERE i."organizationId" <> p."organizationId"
    UNION ALL
    SELECT 'StockMovement.productId', m."id", m."organizationId", p."id", p."organizationId"
    FROM "StockMovement" m JOIN "Product" p ON p."id" = m."productId"
    WHERE m."organizationId" <> p."organizationId"
    UNION ALL
    SELECT 'Sale.customerId', s."id", s."organizationId", c."id", c."organizationId"
    FROM "Sale" s JOIN "Customer" c ON c."id" = s."customerId"
    WHERE s."customerId" IS NOT NULL AND s."organizationId" <> c."organizationId"
    UNION ALL
    SELECT 'SaleItem.saleId', i."id", i."organizationId", s."id", s."organizationId"
    FROM "SaleItem" i JOIN "Sale" s ON s."id" = i."saleId"
    WHERE i."organizationId" <> s."organizationId"
    UNION ALL
    SELECT 'SaleItem.productId', i."id", i."organizationId", p."id", p."organizationId"
    FROM "SaleItem" i JOIN "Product" p ON p."id" = i."productId"
    WHERE i."organizationId" <> p."organizationId"
    UNION ALL
    SELECT 'PurchaseInvoice.supplierId', i."id", i."organizationId", s."id", s."organizationId"
    FROM "PurchaseInvoice" i JOIN "Supplier" s ON s."id" = i."supplierId"
    WHERE i."organizationId" <> s."organizationId"
    UNION ALL
    SELECT 'PurchaseInvoiceItem.purchaseInvoiceId', i."id", i."organizationId", p."id", p."organizationId"
    FROM "PurchaseInvoiceItem" i JOIN "PurchaseInvoice" p ON p."id" = i."purchaseInvoiceId"
    WHERE i."organizationId" <> p."organizationId"
    UNION ALL
    SELECT 'PurchaseInvoiceItem.productId', i."id", i."organizationId", p."id", p."organizationId"
    FROM "PurchaseInvoiceItem" i JOIN "Product" p ON p."id" = i."productId"
    WHERE i."organizationId" <> p."organizationId"
    UNION ALL
    SELECT 'Payment.saleId', p."id", p."organizationId", s."id", s."organizationId"
    FROM "Payment" p JOIN "Sale" s ON s."id" = p."saleId"
    WHERE p."saleId" IS NOT NULL AND p."organizationId" <> s."organizationId"
    UNION ALL
    SELECT 'Payment.purchaseInvoiceId', p."id", p."organizationId", i."id", i."organizationId"
    FROM "Payment" p JOIN "PurchaseInvoice" i ON i."id" = p."purchaseInvoiceId"
    WHERE p."purchaseInvoiceId" IS NOT NULL AND p."organizationId" <> i."organizationId"
    UNION ALL
    SELECT 'OrganizationMember.roleId', m."id", m."organizationId", r."id", r."organizationId"
    FROM "OrganizationMember" m JOIN "Role" r ON r."id" = m."roleId"
    WHERE m."organizationId" <> r."organizationId"
    UNION ALL
    SELECT 'BranchAccess.member-branch', a."memberId" || ':' || a."branchId",
      m."organizationId", b."id", b."organizationId"
    FROM "BranchAccess" a
    JOIN "OrganizationMember" m ON m."id" = a."memberId"
    JOIN "Branch" b ON b."id" = a."branchId"
    WHERE m."organizationId" <> b."organizationId"
  ) violations
  ORDER BY relation, child_id
`;

async function main() {
  await database.$connect();
  try {
    const target = await database.$queryRawUnsafe("SELECT current_database() AS name");
    if (target[0]?.name !== "ubos_development") {
      throw new Error("Refusing preflight: database is not local ubos_development.");
    }
    const rows = await database.$queryRawUnsafe(QUERY);
    const branchAccessCount = await database.$queryRawUnsafe('SELECT count(*)::int AS count FROM "BranchAccess"');
    console.log(JSON.stringify({
      database: target[0].name,
      checkedRelationships: 13,
      branchAccessRowsToBackfill: branchAccessCount[0].count,
      violationCount: rows.length,
      violations: rows,
    }));
    if (rows.length > 0) process.exitCode = 2;
  } finally {
    await database.$disconnect();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
