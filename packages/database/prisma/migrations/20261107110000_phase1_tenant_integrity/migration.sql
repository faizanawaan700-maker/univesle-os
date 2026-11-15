-- DATA-05: bind organization-owned references to the same organization.
-- BranchAccess has no tenant column in the existing schema. Expand, backfill
-- the new column from its existing member relationship, then enforce NOT NULL.
ALTER TABLE "BranchAccess" ADD COLUMN "organizationId" TEXT;
UPDATE "BranchAccess" AS access
SET "organizationId" = member."organizationId"
FROM "OrganizationMember" AS member
WHERE member."id" = access."memberId";
ALTER TABLE "BranchAccess" ALTER COLUMN "organizationId" SET NOT NULL;

CREATE UNIQUE INDEX "Branch_organizationId_id_key" ON "Branch"("organizationId", "id");
CREATE UNIQUE INDEX "Customer_organizationId_id_key" ON "Customer"("organizationId", "id");
CREATE UNIQUE INDEX "Inventory_organizationId_productId_key" ON "Inventory"("organizationId", "productId");
CREATE UNIQUE INDEX "OrganizationMember_organizationId_id_key" ON "OrganizationMember"("organizationId", "id");
CREATE UNIQUE INDEX "Product_organizationId_id_key" ON "Product"("organizationId", "id");
CREATE UNIQUE INDEX "ProductCategory_organizationId_id_key" ON "ProductCategory"("organizationId", "id");
CREATE UNIQUE INDEX "PurchaseInvoice_organizationId_id_key" ON "PurchaseInvoice"("organizationId", "id");
CREATE UNIQUE INDEX "Role_organizationId_id_key" ON "Role"("organizationId", "id");
CREATE UNIQUE INDEX "Sale_organizationId_id_key" ON "Sale"("organizationId", "id");
CREATE UNIQUE INDEX "Supplier_organizationId_id_key" ON "Supplier"("organizationId", "id");

ALTER TABLE "OrganizationMember" ADD CONSTRAINT "OrganizationMember_organizationId_roleId_fkey"
  FOREIGN KEY ("organizationId", "roleId") REFERENCES "Role"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Product" ADD CONSTRAINT "Product_organizationId_categoryId_fkey"
  FOREIGN KEY ("organizationId", "categoryId") REFERENCES "ProductCategory"("organizationId", "id") ON DELETE NO ACTION ON UPDATE CASCADE;
ALTER TABLE "Inventory" ADD CONSTRAINT "Inventory_organizationId_productId_fkey"
  FOREIGN KEY ("organizationId", "productId") REFERENCES "Product"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_organizationId_productId_fkey"
  FOREIGN KEY ("organizationId", "productId") REFERENCES "Product"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Sale" ADD CONSTRAINT "Sale_organizationId_customerId_fkey"
  FOREIGN KEY ("organizationId", "customerId") REFERENCES "Customer"("organizationId", "id") ON DELETE NO ACTION ON UPDATE CASCADE;
ALTER TABLE "SaleItem" ADD CONSTRAINT "SaleItem_organizationId_saleId_fkey"
  FOREIGN KEY ("organizationId", "saleId") REFERENCES "Sale"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SaleItem" ADD CONSTRAINT "SaleItem_organizationId_productId_fkey"
  FOREIGN KEY ("organizationId", "productId") REFERENCES "Product"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PurchaseInvoice" ADD CONSTRAINT "PurchaseInvoice_organizationId_supplierId_fkey"
  FOREIGN KEY ("organizationId", "supplierId") REFERENCES "Supplier"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PurchaseInvoiceItem" ADD CONSTRAINT "PurchaseInvoiceItem_organizationId_purchaseInvoiceId_fkey"
  FOREIGN KEY ("organizationId", "purchaseInvoiceId") REFERENCES "PurchaseInvoice"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PurchaseInvoiceItem" ADD CONSTRAINT "PurchaseInvoiceItem_organizationId_productId_fkey"
  FOREIGN KEY ("organizationId", "productId") REFERENCES "Product"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_organizationId_saleId_fkey"
  FOREIGN KEY ("organizationId", "saleId") REFERENCES "Sale"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_organizationId_purchaseInvoiceId_fkey"
  FOREIGN KEY ("organizationId", "purchaseInvoiceId") REFERENCES "PurchaseInvoice"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BranchAccess" ADD CONSTRAINT "BranchAccess_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BranchAccess" ADD CONSTRAINT "BranchAccess_organizationId_memberId_fkey"
  FOREIGN KEY ("organizationId", "memberId") REFERENCES "OrganizationMember"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BranchAccess" ADD CONSTRAINT "BranchAccess_organizationId_branchId_fkey"
  FOREIGN KEY ("organizationId", "branchId") REFERENCES "Branch"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
