/**
 * UBOS browser E2E — real Phase 2 user journeys against the running API + web client.
 *
 * Covers the Phase 2 acceptance criteria (OPS-01..OPS-04): multi-line sales and
 * purchases with reconciled totals, persisted invoice details and payment
 * history, customer/supplier editing with explicit null clears, payment
 * references, and outstanding-only payment targets.
 *
 * Each test registers a brand-new account (unique email) so runs are isolated.
 * The API throttles registration to 8/minute per IP, so the helper honours the
 * server's Retry-After window instead of disabling the control.
 */
import { test, expect, type Page } from "@playwright/test";

const password = "e2e-browser-test-password";

function uniqueEmail(label: string) {
  return `e2e-${label}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`;
}

/** The success alert only; `role=status` also matches the loading placeholder. */
function successBanner(page: Page, text: string) {
  return page.locator(".alert.success", { hasText: text });
}

async function registerWorkspace(page: Page, label: string) {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    await page.goto("/");
    await page.getByLabel("Your name").fill(`E2E ${label}`);
    await page.getByLabel("Business or organization").fill(`E2E Org ${label}`);
    await page.getByLabel("Work email").fill(uniqueEmail(label));
    await page.getByLabel("Password").fill(password);
    const responsePromise = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === "/auth/register" &&
        response.request().method() === "POST",
    );
    await page.getByRole("button", { name: /Create workspace/i }).click();
    const response = await responsePromise;
    if (response.status() === 201) {
      await expect(
        page.getByRole("heading", { name: /Good to have you here/i }),
      ).toBeVisible({ timeout: 30_000 });
      return;
    }
    expect(
      response.status(),
      `registration response: ${response.status()}`,
    ).toBe(429);
    const retryAfter = Number(response.headers()["retry-after"] ?? 60);
    await page.waitForTimeout((retryAfter + 1) * 1000);
  }
  throw new Error(
    "Registration remained throttled after honoring Retry-After responses.",
  );
}

async function openTab(page: Page, name: string) {
  const tab = page.getByRole("tab", { name, exact: true });
  await tab.click();
  await expect(tab).toHaveAttribute("aria-selected", "true");
  // The panel swaps to a "Loading <tab>…" placeholder, then renders a form,
  // table or empty state. A persistent success banner is unrelated, so wait for
  // the panel itself to stop showing its loading placeholder.
  const panel = page.locator("#business-panel");
  await expect(panel).toBeVisible();
  await expect(panel.locator("p.business-state").filter({ hasText: /^Loading / }))
    .toHaveCount(0, { timeout: 20_000 });
  await expect(page.getByRole("heading", { name: /Application error/i })).toHaveCount(0);
}

async function createProduct(page: Page, name: string) {
  await openTab(page, "Products");
  await page.getByLabel("Product name").fill(name);
  await page.getByLabel("Selling price").fill("10.00");
  await page.getByLabel("Unit cost").fill("5.00");
  await page.getByRole("button", { name: /Create product/i }).click();
  await expect(page.getByRole("cell", { name })).toBeVisible({
    timeout: 15_000,
  });
}

/** Sales and purchases must respect the no-negative-stock rule, so stock is
 *  received before a product can be sold. */
async function seedStock(page: Page, productName: string, units: number) {
  await openTab(page, "Inventory");
  const form = page.locator("form", {
    has: page.getByRole("heading", { name: "Adjust stock" }),
  });
  await form.locator('select[name="productId"]').selectOption({ label: productName });
  await form.locator('input[name="quantityDelta"]').fill(String(units));
  await form.getByRole("button", { name: /Record adjustment/i }).click();
  await expect(successBanner(page, "Stock adjustment recorded")).toBeVisible();
}

test("registers a workspace and lands on the business dashboard", async ({
  page,
}) => {
  const consoleErrors: string[] = [];
  page.on("pageerror", (error) =>
    consoleErrors.push(`PAGEERROR ${error.message}`),
  );
  await registerWorkspace(page, "register");
  await expect(
    page.getByRole("heading", { name: "Manage your business" }),
  ).toBeVisible();
  await expect(page.getByRole("tab", { name: "Overview" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Products" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Sales" })).toBeVisible();
  expect(consoleErrors).toEqual([]);
});

test("creates a product and sees it in the catalog table", async ({ page }) => {
  await registerWorkspace(page, "product");
  await createProduct(page, `E2E Widget ${Date.now()}`);
});

test("creates a customer and edits it, clearing the email", async ({
  page,
}) => {
  await registerWorkspace(page, "customer");
  await openTab(page, "Customers");

  const customerName = `E2E Customer ${Date.now()}`;
  await page.getByLabel("Name", { exact: true }).first().fill(customerName);
  await page
    .getByLabel("Email", { exact: true })
    .first()
    .fill("customer@example.com");
  await page.getByRole("button", { name: /Create customer/i }).click();
  await expect(page.getByRole("cell", { name: customerName })).toBeVisible({
    timeout: 15_000,
  });
  await expect(
    page.getByRole("cell", { name: "customer@example.com" }),
  ).toBeVisible();

  await page
    .getByRole("row", { name: new RegExp(customerName) })
    .getByRole("button", { name: "Edit" })
    .click();
  const editForm = page.locator("form", {
    has: page.getByRole("heading", { name: "Edit customer" }),
  });
  await editForm.locator('input[name="email"]').fill("");
  await editForm.getByRole("button", { name: "Save changes" }).click();

  await expect(successBanner(page, "Customer updated")).toBeVisible();
  await expect(page.getByRole("cell", { name: customerName })).toBeVisible({
    timeout: 15_000,
  });
  await expect(
    page.getByRole("cell", { name: "customer@example.com" }),
  ).toHaveCount(0);
});

test("creates a multi-line sale and shows reconciled invoice details", async ({
  page,
}) => {
  await registerWorkspace(page, "sale");
  const productName = `E2E Sale Product ${Date.now()}`;
  await createProduct(page, productName);
  await seedStock(page, productName, 10);

  await openTab(page, "Sales");
  await page.getByLabel("Product 1").selectOption({ label: productName });
  await page.getByLabel("Quantity").first().fill("2");
  await page.getByRole("button", { name: /Add line/i }).click();
  await page.getByLabel("Product 2").selectOption({ label: productName });
  await page.getByLabel("Quantity").nth(1).fill("3");
  await page.getByRole("button", { name: /^Create invoice$/i }).click();

  await expect(successBanner(page, "Sales invoice created")).toBeVisible();
  // Persisted decimals are rendered as stored: 2×10 + 3×10 = 50.
  await expect(page.getByRole("cell", { name: "50", exact: true }).first()).toBeVisible({
    timeout: 15_000,
  });

  await page.getByText("View details").first().click();
  // Two lines of 2 × 10.00 and 3 × 10.00 reconcile to the 50.00 server total.
  await expect(page.getByText(/· 2 × 10(?:\.00)? = 20(?:\.00)?/)).toBeVisible();
  await expect(page.getByText(/· 3 × 10(?:\.00)? = 30(?:\.00)?/)).toBeVisible();
});

test("records a referenced payment and removes the settled invoice from targets", async ({
  page,
}) => {
  await registerWorkspace(page, "payment");
  const productName = `E2E Pay Product ${Date.now()}`;
  await createProduct(page, productName);
  await seedStock(page, productName, 5);

  await openTab(page, "Sales");
  await page.getByLabel("Product 1").selectOption({ label: productName });
  await page.getByLabel("Quantity").first().fill("1");
  await page.getByRole("button", { name: /^Create invoice$/i }).click();
  await expect(successBanner(page, "Sales invoice created")).toBeVisible();

  const reference = `E2E-REF-${Date.now()}`;
  await page.getByLabel("Invoice").selectOption({ index: 1 });
  await page.getByLabel("Amount").fill("10.00");
  await page.getByLabel("Reference").fill(reference);
  await page.getByRole("button", { name: /Record payment/i }).click();
  await expect(
    successBanner(page, "Customer payment recorded"),
  ).toBeVisible();

  // The invoice is fully settled, so it is no longer offered as a payment target.
  await expect(
    page.getByRole("button", { name: /Record payment/i }),
  ).toHaveCount(0);
  await page.getByText("View details").first().click();
  await expect(
    page.getByText(reference, { exact: false }).first(),
  ).toBeVisible();
});

test("receives a multi-line purchase and shows its details", async ({
  page,
}) => {
  await registerWorkspace(page, "purchase");

  await openTab(page, "Suppliers");
  const supplierName = `E2E Supplier ${Date.now()}`;
  const supplierForm = page.locator("form", {
    has: page.getByRole("heading", { name: "Add supplier" }),
  });
  await supplierForm.locator('input[name="name"]').fill(supplierName);
  await supplierForm.getByRole("button", { name: /Create supplier/i }).click();
  await expect(page.getByRole("cell", { name: supplierName })).toBeVisible({
    timeout: 15_000,
  });

  const productName = `E2E Purchase Product ${Date.now()}`;
  await createProduct(page, productName);

  await openTab(page, "Purchases");
  const purchaseForm = page.locator("form", {
    has: page.getByRole("heading", { name: "Receive purchase invoice" }),
  });
  await purchaseForm
    .locator('select[name="supplierId"]')
    .selectOption({ label: supplierName });
  await purchaseForm
    .locator('input[name="invoiceNumber"]')
    .fill(`SUP-${Date.now()}`);
  await purchaseForm
    .locator('select[name="productId-0"]')
    .selectOption({ label: productName });
  await purchaseForm.locator('input[name="quantity-0"]').fill("4");
  await purchaseForm.locator('input[name="unitCost-0"]').fill("5.00");
  await purchaseForm.getByRole("button", { name: /Add line/i }).click();
  await purchaseForm
    .locator('select[name="productId-1"]')
    .selectOption({ label: productName });
  await purchaseForm.locator('input[name="quantity-1"]').fill("2");
  await purchaseForm.locator('input[name="unitCost-1"]').fill("5.00");
  await purchaseForm.getByRole("button", { name: /^Receive invoice$/i }).click();

  await expect(
    successBanner(page, "Purchase invoice recorded"),
  ).toBeVisible();
  await expect(page.getByRole("cell", { name: "30", exact: true }).first()).toBeVisible({
    timeout: 15_000,
  });
  await page.getByText("View details").first().click();
  await expect(page.getByText(/· 4 × 5(?:\.00)? = 20(?:\.00)?/)).toBeVisible();
  await expect(page.getByText(/· 2 × 5(?:\.00)? = 10(?:\.00)?/)).toBeVisible();
});

test("records a stock adjustment and shows it in movement history", async ({
  page,
}) => {
  await registerWorkspace(page, "inventory");
  const productName = `E2E Stock Product ${Date.now()}`;
  await createProduct(page, productName);

  await openTab(page, "Inventory");
  const adjustmentForm = page.locator("form", {
    has: page.getByRole("heading", { name: "Adjust stock" }),
  });
  await adjustmentForm
    .locator('select[name="productId"]')
    .selectOption({ label: productName });
  await adjustmentForm.locator('input[name="quantityDelta"]').fill("7");
  await adjustmentForm
    .getByRole("button", { name: /Record adjustment/i })
    .click();

  await expect(
    successBanner(page, "Stock adjustment recorded"),
  ).toBeVisible();
  await expect(page.getByRole("cell", { name: "7", exact: true })).toBeVisible({
    timeout: 15_000,
  });
});
