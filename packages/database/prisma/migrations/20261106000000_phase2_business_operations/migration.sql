CREATE TABLE "ProductCategory" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ProductCategory_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Product" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "categoryId" TEXT,
    "name" VARCHAR(160) NOT NULL,
    "sku" VARCHAR(80),
    "barcode" VARCHAR(80),
    "unitPrice" DECIMAL(14,2) NOT NULL,
    "costPrice" DECIMAL(14,2) NOT NULL,
    "lowStockAt" INTEGER NOT NULL DEFAULT 5,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Inventory" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Inventory_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "StockMovement" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "actorId" TEXT,
    "quantityDelta" INTEGER NOT NULL,
    "reason" VARCHAR(40) NOT NULL,
    "referenceId" VARCHAR(100),
    "note" VARCHAR(500),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "StockMovement_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Customer" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "email" VARCHAR(320),
    "phone" VARCHAR(40),
    "notes" VARCHAR(1000),
    "marketingConsent" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Customer_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Supplier" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "email" VARCHAR(320),
    "phone" VARCHAR(40),
    "notes" VARCHAR(1000),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Supplier_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Sale" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "customerId" TEXT,
    "invoiceNumber" VARCHAR(40) NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'issued',
    "subtotal" DECIMAL(14,2) NOT NULL,
    "discount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "tax" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(14,2) NOT NULL,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dueAt" TIMESTAMP(3),
    CONSTRAINT "Sale_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SaleItem" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "saleId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "description" VARCHAR(160) NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unitPrice" DECIMAL(14,2) NOT NULL,
    "lineTotal" DECIMAL(14,2) NOT NULL,
    CONSTRAINT "SaleItem_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PurchaseInvoice" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "invoiceNumber" VARCHAR(80) NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'received',
    "subtotal" DECIMAL(14,2) NOT NULL,
    "tax" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(14,2) NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dueAt" TIMESTAMP(3),
    CONSTRAINT "PurchaseInvoice_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PurchaseInvoiceItem" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "purchaseInvoiceId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "description" VARCHAR(160) NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unitCost" DECIMAL(14,2) NOT NULL,
    "lineTotal" DECIMAL(14,2) NOT NULL,
    CONSTRAINT "PurchaseInvoiceItem_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Payment" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "saleId" TEXT,
    "purchaseInvoiceId" TEXT,
    "amount" DECIMAL(14,2) NOT NULL,
    "method" VARCHAR(30) NOT NULL,
    "reference" VARCHAR(100),
    "paidAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ProductCategory_organizationId_name_key" ON "ProductCategory"("organizationId", "name");
CREATE INDEX "ProductCategory_organizationId_idx" ON "ProductCategory"("organizationId");
CREATE UNIQUE INDEX "Product_organizationId_sku_key" ON "Product"("organizationId", "sku");
CREATE UNIQUE INDEX "Product_organizationId_barcode_key" ON "Product"("organizationId", "barcode");
CREATE INDEX "Product_organizationId_name_idx" ON "Product"("organizationId", "name");
CREATE INDEX "Product_organizationId_categoryId_idx" ON "Product"("organizationId", "categoryId");
CREATE UNIQUE INDEX "Inventory_productId_key" ON "Inventory"("productId");
CREATE INDEX "Inventory_organizationId_quantity_idx" ON "Inventory"("organizationId", "quantity");
CREATE INDEX "StockMovement_organizationId_createdAt_idx" ON "StockMovement"("organizationId", "createdAt");
CREATE INDEX "StockMovement_organizationId_productId_createdAt_idx" ON "StockMovement"("organizationId", "productId", "createdAt");
CREATE INDEX "Customer_organizationId_name_idx" ON "Customer"("organizationId", "name");
CREATE INDEX "Customer_organizationId_email_idx" ON "Customer"("organizationId", "email");
CREATE INDEX "Supplier_organizationId_name_idx" ON "Supplier"("organizationId", "name");
CREATE INDEX "Supplier_organizationId_email_idx" ON "Supplier"("organizationId", "email");
CREATE UNIQUE INDEX "Sale_organizationId_invoiceNumber_key" ON "Sale"("organizationId", "invoiceNumber");
CREATE INDEX "Sale_organizationId_issuedAt_idx" ON "Sale"("organizationId", "issuedAt");
CREATE INDEX "Sale_organizationId_customerId_idx" ON "Sale"("organizationId", "customerId");
CREATE INDEX "SaleItem_organizationId_saleId_idx" ON "SaleItem"("organizationId", "saleId");
CREATE INDEX "SaleItem_organizationId_productId_idx" ON "SaleItem"("organizationId", "productId");
CREATE UNIQUE INDEX "PurchaseInvoice_organizationId_invoiceNumber_key" ON "PurchaseInvoice"("organizationId", "invoiceNumber");
CREATE INDEX "PurchaseInvoice_organizationId_receivedAt_idx" ON "PurchaseInvoice"("organizationId", "receivedAt");
CREATE INDEX "PurchaseInvoice_organizationId_supplierId_idx" ON "PurchaseInvoice"("organizationId", "supplierId");
CREATE INDEX "PurchaseInvoiceItem_organizationId_purchaseInvoiceId_idx" ON "PurchaseInvoiceItem"("organizationId", "purchaseInvoiceId");
CREATE INDEX "PurchaseInvoiceItem_organizationId_productId_idx" ON "PurchaseInvoiceItem"("organizationId", "productId");
CREATE INDEX "Payment_organizationId_paidAt_idx" ON "Payment"("organizationId", "paidAt");
CREATE INDEX "Payment_organizationId_saleId_idx" ON "Payment"("organizationId", "saleId");
CREATE INDEX "Payment_organizationId_purchaseInvoiceId_idx" ON "Payment"("organizationId", "purchaseInvoiceId");

ALTER TABLE "ProductCategory" ADD CONSTRAINT "ProductCategory_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Product" ADD CONSTRAINT "Product_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Product" ADD CONSTRAINT "Product_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "ProductCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Inventory" ADD CONSTRAINT "Inventory_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Inventory" ADD CONSTRAINT "Inventory_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Customer" ADD CONSTRAINT "Customer_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Supplier" ADD CONSTRAINT "Supplier_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Sale" ADD CONSTRAINT "Sale_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Sale" ADD CONSTRAINT "Sale_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SaleItem" ADD CONSTRAINT "SaleItem_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "Sale"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SaleItem" ADD CONSTRAINT "SaleItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PurchaseInvoice" ADD CONSTRAINT "PurchaseInvoice_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PurchaseInvoice" ADD CONSTRAINT "PurchaseInvoice_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PurchaseInvoiceItem" ADD CONSTRAINT "PurchaseInvoiceItem_purchaseInvoiceId_fkey" FOREIGN KEY ("purchaseInvoiceId") REFERENCES "PurchaseInvoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PurchaseInvoiceItem" ADD CONSTRAINT "PurchaseInvoiceItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "Sale"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_purchaseInvoiceId_fkey" FOREIGN KEY ("purchaseInvoiceId") REFERENCES "PurchaseInvoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "Permission" ("id", "key", "description") VALUES
    (gen_random_uuid()::text, 'catalog.read', 'View product catalog and stock levels.'),
    (gen_random_uuid()::text, 'catalog.manage', 'Manage product categories and products.'),
    (gen_random_uuid()::text, 'inventory.read', 'View inventory and stock movement history.'),
    (gen_random_uuid()::text, 'inventory.manage', 'Adjust stock and receive purchased goods.'),
    (gen_random_uuid()::text, 'sales.read', 'View sales invoices and balances.'),
    (gen_random_uuid()::text, 'sales.manage', 'Create sales invoices and record receipts.'),
    (gen_random_uuid()::text, 'customers.read', 'View customer records.'),
    (gen_random_uuid()::text, 'customers.manage', 'Manage customer records.'),
    (gen_random_uuid()::text, 'procurement.read', 'View suppliers and purchase invoices.'),
    (gen_random_uuid()::text, 'procurement.manage', 'Manage suppliers and purchase invoices.'),
    (gen_random_uuid()::text, 'payments.manage', 'Record business payments.'),
    (gen_random_uuid()::text, 'reports.read', 'View organization business reports.')
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "RolePermission" ("roleId", "permissionId")
SELECT role."id", permission."id"
FROM "Role" role
JOIN "Permission" permission ON permission."key" IN (
    'catalog.read', 'catalog.manage', 'inventory.read', 'inventory.manage',
    'sales.read', 'sales.manage', 'customers.read', 'customers.manage',
    'procurement.read', 'procurement.manage', 'payments.manage', 'reports.read'
)
WHERE role."key" = 'owner'
ON CONFLICT ("roleId", "permissionId") DO NOTHING;
