const dotenv = require("dotenv");
const { resolve } = require("node:path");

dotenv.config({ path: resolve(__dirname, "../../../packages/database/.env"), quiet: true });

const { database } = require("@ubos/database");

const expectedConstraints = [
  "OrganizationMember_organizationId_roleId_fkey",
  "Product_organizationId_categoryId_fkey",
  "Inventory_organizationId_productId_fkey",
  "StockMovement_organizationId_productId_fkey",
  "Sale_organizationId_customerId_fkey",
  "SaleItem_organizationId_saleId_fkey",
  "SaleItem_organizationId_productId_fkey",
  "PurchaseInvoice_organizationId_supplierId_fkey",
  "PurchaseInvoiceItem_organizationId_purchaseInvoiceId_fkey",
  "PurchaseInvoiceItem_organizationId_productId_fkey",
  "Payment_organizationId_saleId_fkey",
  "Payment_organizationId_purchaseInvoiceId_fkey",
  "BranchAccess_organizationId_fkey",
  "BranchAccess_organizationId_memberId_fkey",
  "BranchAccess_organizationId_branchId_fkey",
];

async function main() {
  await database.$connect();
  try {
    const target = await database.$queryRawUnsafe("SELECT current_database() AS name");
    if (target[0]?.name !== "ubos_development") {
      throw new Error("Refusing verification: database is not local ubos_development.");
    }
    const constraints = await database.$queryRaw`
      SELECT conname AS name, convalidated AS validated
      FROM pg_constraint
      WHERE contype = 'f' AND conname = ANY(${expectedConstraints})
      ORDER BY conname
    `;
    const branchAccess = await database.$queryRawUnsafe(`
      SELECT count(*)::int AS count,
             count(*) FILTER (WHERE "organizationId" IS NULL)::int AS null_tenant_count
      FROM "BranchAccess"
    `);
    const violations = await database.$queryRawUnsafe(`
      SELECT count(*)::int AS count
      FROM (
        SELECT 1 FROM "Product" p JOIN "ProductCategory" c ON c.id = p."categoryId"
          WHERE p."organizationId" <> c."organizationId"
        UNION ALL SELECT 1 FROM "Inventory" i JOIN "Product" p ON p.id = i."productId"
          WHERE i."organizationId" <> p."organizationId"
        UNION ALL SELECT 1 FROM "StockMovement" m JOIN "Product" p ON p.id = m."productId"
          WHERE m."organizationId" <> p."organizationId"
        UNION ALL SELECT 1 FROM "Sale" s JOIN "Customer" c ON c.id = s."customerId"
          WHERE s."customerId" IS NOT NULL AND s."organizationId" <> c."organizationId"
        UNION ALL SELECT 1 FROM "SaleItem" i JOIN "Sale" s ON s.id = i."saleId"
          WHERE i."organizationId" <> s."organizationId"
        UNION ALL SELECT 1 FROM "SaleItem" i JOIN "Product" p ON p.id = i."productId"
          WHERE i."organizationId" <> p."organizationId"
        UNION ALL SELECT 1 FROM "PurchaseInvoice" i JOIN "Supplier" s ON s.id = i."supplierId"
          WHERE i."organizationId" <> s."organizationId"
        UNION ALL SELECT 1 FROM "PurchaseInvoiceItem" i JOIN "PurchaseInvoice" p ON p.id = i."purchaseInvoiceId"
          WHERE i."organizationId" <> p."organizationId"
        UNION ALL SELECT 1 FROM "PurchaseInvoiceItem" i JOIN "Product" p ON p.id = i."productId"
          WHERE i."organizationId" <> p."organizationId"
        UNION ALL SELECT 1 FROM "Payment" p JOIN "Sale" s ON s.id = p."saleId"
          WHERE p."saleId" IS NOT NULL AND p."organizationId" <> s."organizationId"
        UNION ALL SELECT 1 FROM "Payment" p JOIN "PurchaseInvoice" i ON i.id = p."purchaseInvoiceId"
          WHERE p."purchaseInvoiceId" IS NOT NULL AND p."organizationId" <> i."organizationId"
        UNION ALL SELECT 1 FROM "OrganizationMember" m JOIN "Role" r ON r.id = m."roleId"
          WHERE m."organizationId" <> r."organizationId"
        UNION ALL SELECT 1 FROM "BranchAccess" a
          JOIN "OrganizationMember" m ON m.id = a."memberId"
          JOIN "Branch" b ON b.id = a."branchId"
          WHERE a."organizationId" <> m."organizationId"
             OR a."organizationId" <> b."organizationId"
      ) mismatches
    `);
    const result = {
      database: target[0].name,
      expectedForeignKeys: expectedConstraints.length,
      foundForeignKeys: constraints.length,
      allForeignKeysValidated: constraints.length === expectedConstraints.length && constraints.every((row) => row.validated),
      branchAccessRows: branchAccess[0].count,
      branchAccessRowsWithoutTenant: branchAccess[0].null_tenant_count,
      tenantMismatchCount: violations[0].count,
      constraints,
    };
    console.log(JSON.stringify(result));
    if (!result.allForeignKeysValidated || result.branchAccessRowsWithoutTenant || result.tenantMismatchCount) {
      process.exitCode = 2;
    }
  } finally {
    await database.$disconnect();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
