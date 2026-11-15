"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getApiBaseUrl } from "./api-base";

type Page<T> = { items: T[]; hasMore: boolean; nextCursor: string | null };
type Category = { id: string; name: string };
type Product = {
  id: string;
  name: string;
  sku: string | null;
  unitPrice: string;
  costPrice: string;
  lowStockAt: number;
  isActive: boolean;
  category: Category | null;
  inventory: { quantity: number } | null;
};
type Contact = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  notes?: string | null;
};
type InvoiceLine = {
  id: string;
  productId: string;
  quantity: number;
  unitPrice?: string;
  unitCost?: string;
  lineTotal?: string;
};
type PaymentReference = {
  id: string;
  amount: string;
  method: string;
  reference: string | null;
  paidAt: string;
};
type Invoice = {
  id: string;
  invoiceNumber: string;
  total: string;
  outstanding: string;
  issuedAt?: string;
  receivedAt?: string;
  customer?: Contact | null;
  supplier?: Contact | null;
  items?: InvoiceLine[];
  payments?: PaymentReference[];
};
type Payment = {
  id: string;
  amount: string;
  method: string;
  reference: string | null;
  paidAt: string;
  sale: { id: string; invoiceNumber: string; total: string } | null;
  purchaseInvoice: { id: string; invoiceNumber: string; total: string } | null;
};
type Inventory = {
  items: Array<{ productId: string; quantity: number; product: Product }>;
  recentMovements: Array<{
    id: string;
    reason: string;
    quantityDelta: number;
    createdAt: string;
    product: { id: string; name: string; sku: string | null };
  }>;
};
type Summary = {
  salesTotal: string;
  customerOutstanding: string;
  purchasesTotal: string;
  supplierOutstanding: string;
  inventoryUnits: number;
  inventoryCostValue: string;
  lowStockProducts: Array<{ name: string; quantity: number }>;
};

type Tab =
  | "summary"
  | "products"
  | "inventory"
  | "customers"
  | "suppliers"
  | "sales"
  | "purchases"
  | "payments";

const tabs: Array<[Tab, string, string]> = [
  ["summary", "Overview", "reports.read"],
  ["products", "Products", "catalog.read"],
  ["inventory", "Inventory", "inventory.read"],
  ["customers", "Customers", "customers.read"],
  ["suppliers", "Suppliers", "procurement.read"],
  ["sales", "Sales", "sales.read"],
  ["purchases", "Purchases", "procurement.read"],
  ["payments", "Payments", "payments.manage"],
];

class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function api<T>(
  path: string,
  organizationId: string,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(`${getApiBaseUrl()}${path}`, {
    ...init,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      "X-Organization-Id": organizationId,
      ...init?.headers,
    },
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    const message = Array.isArray(body?.message)
      ? body.message.join(" ")
      : body?.message;
    throw new ApiError(
      message || `Request failed (${response.status}).`,
      response.status,
    );
  }
  return response.json() as Promise<T>;
}

/** Phase 3 list endpoints return `{ items, hasMore, nextCursor }`. */
async function list<T>(path: string, organizationId: string): Promise<T[]> {
  const result = await api<Page<T> | T[]>(path, organizationId);
  return Array.isArray(result) ? result : (result.items ?? []);
}

function optional(value: FormDataEntryValue | null): string | undefined {
  const text = String(value ?? "").trim();
  return text === "" ? undefined : text;
}

/** Explicit clear semantics for nullable contact fields (OPS-03). */
function clearable(value: FormDataEntryValue | null, current: string | null | undefined) {
  const text = String(value ?? "").trim();
  if (text !== "") return text;
  return current ? null : undefined;
}

export function BusinessOperations({
  organizationId,
  permissions,
}: {
  organizationId: string;
  permissions: string[];
}) {
  const [activeTab, setActiveTab] = useState<Tab>("summary");
  const [data, setData] = useState<unknown>(null);
  const [options, setOptions] = useState<{
    products: Product[];
    customers: Contact[];
    suppliers: Contact[];
    categories: Category[];
  }>({ products: [], customers: [], suppliers: [], categories: [] });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const submittingRef = useRef(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
  const [editingContactId, setEditingContactId] = useState<string | null>(null);
  const [productSearch, setProductSearch] = useState("");
  const [includeArchived, setIncludeArchived] = useState(false);
  const loadRequestRef = useRef(0);

  const visibleTabs = useMemo(
    () => tabs.filter(([, , permission]) => permissions.includes(permission)),
    [permissions],
  );

  useEffect(() => {
    if (visibleTabs.length > 0 && !visibleTabs.some(([id]) => id === activeTab)) {
      setActiveTab(visibleTabs[0][0]);
    }
  }, [activeTab, visibleTabs]);

  const load = useCallback(async () => {
    const requestId = ++loadRequestRef.current;
    const isCurrent = () => requestId === loadRequestRef.current;
    setLoading(true);
    setError("");
    setData(null);
    try {
      if (activeTab === "summary") {
        setData(await api<Summary>("/business/reports/summary", organizationId));
      } else if (activeTab === "products") {
        const params = new URLSearchParams({ limit: "50" });
        if (productSearch.trim()) params.set("search", productSearch.trim());
        if (includeArchived) params.set("includeInactive", "true");
        const [products, categories] = await Promise.all([
          list<Product>(`/business/products?${params.toString()}`, organizationId),
          // `/categories` is not paginated: it returns a bare array.
          api<Category[]>("/business/categories", organizationId),
        ]);
        if (!isCurrent()) return;
        setData(products);
        setOptions((current) => ({ ...current, products, categories }));
      } else if (activeTab === "inventory") {
        const [inventory, products] = await Promise.all([
          api<Inventory>("/business/inventory", organizationId),
          list<Product>("/business/products?limit=50", organizationId),
        ]);
        if (!isCurrent()) return;
        setData(inventory);
        setOptions((current) => ({ ...current, products }));
      } else if (activeTab === "customers") {
        const [customers, categories] = await Promise.all([
          list<Contact>("/business/customers?limit=50", organizationId),
          api<Category[]>("/business/categories", organizationId),
        ]);
        if (!isCurrent()) return;
        setData(customers);
        setOptions((current) => ({ ...current, customers, categories }));
      } else if (activeTab === "suppliers") {
        const [suppliers, products] = await Promise.all([
          list<Contact>("/business/suppliers?limit=50", organizationId),
          list<Product>("/business/products?limit=50", organizationId),
        ]);
        if (!isCurrent()) return;
        setData(suppliers);
        setOptions((current) => ({ ...current, suppliers, products }));
      } else if (activeTab === "sales") {
        const [sales, products, customers] = await Promise.all([
          list<Invoice>("/business/sales?limit=50", organizationId),
          list<Product>("/business/products?limit=50", organizationId),
          list<Contact>("/business/customers?limit=50", organizationId),
        ]);
        if (!isCurrent()) return;
        setData(sales);
        setOptions((current) => ({ ...current, sales: [], products, customers }));
      } else if (activeTab === "purchases") {
        const [purchases, products, suppliers] = await Promise.all([
          list<Invoice>("/business/purchases?limit=50", organizationId),
          list<Product>("/business/products?limit=50", organizationId),
          list<Contact>("/business/suppliers?limit=50", organizationId),
        ]);
        if (!isCurrent()) return;
        setData(purchases);
        setOptions((current) => ({ ...current, products, suppliers }));
      } else if (activeTab === "payments") {
        setData(await list<Payment>("/business/payments?limit=50", organizationId));
      }
    } catch (cause) {
      if (isCurrent()) {
        setError(
          cause instanceof Error ? cause.message : "Could not load business data.",
        );
      }
    } finally {
      if (isCurrent()) setLoading(false);
    }
  }, [activeTab, organizationId, reloadKey, productSearch, includeArchived]);

  useEffect(() => {
    void load();
  }, [load]);

  async function submit(
    formElement: HTMLFormElement,
    path: string,
    payload: Record<string, unknown>,
    successMessage: string,
    method: "POST" | "PATCH" = "POST",
    idempotencyKey?: string,
  ) {
    if (submittingRef.current) return;
    submittingRef.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await api(path, organizationId, {
        method,
        body: JSON.stringify(payload),
        headers: idempotencyKey ? { "Idempotency-Key": idempotencyKey } : undefined,
      });
      setNotice(successMessage);
      formElement.reset();
      setEditingContactId(null);
      setReloadKey((key) => key + 1);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The request failed.");
    } finally {
      submittingRef.current = false;
      setBusy(false);
    }
  }

  /** Archive/restore: no form body, so it bypasses the form submit path. */
  async function runCommand(path: string, message: string) {
    if (submittingRef.current) return;
    submittingRef.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await api(path, organizationId, { method: "POST" });
      setNotice(message);
      setReloadKey((key) => key + 1);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The request failed.");
    } finally {
      submittingRef.current = false;
      setBusy(false);
    }
  }

  function handleSubmit(
    event: FormEvent<HTMLFormElement>,
    path: string,
    buildPayload: (form: FormData) => Record<string, unknown>,
    message: string,
    method: "POST" | "PATCH" = "POST",
    idempotencyKey?: string,
  ) {
    event.preventDefault();
    const formElement = event.currentTarget;
    void submit(
      formElement,
      path,
      buildPayload(new FormData(formElement)),
      message,
      method,
      idempotencyKey ?? (method === "POST" ? crypto.randomUUID() : undefined),
    );
  }

  return (
    <section
      className="business-section"
      id="business-operations"
      aria-labelledby="business-title"
    >
      <div className="business-heading">
        <div>
          <p className="eyebrow">BUSINESS OPERATIONS</p>
          <h2 id="business-title">Manage your business</h2>
          <p className="page-description">
            Organization-scoped records, stock activity and balances from the API.
          </p>
        </div>
        <button
          className="secondary-button"
          type="button"
          onClick={() => setReloadKey((key) => key + 1)}
          disabled={loading}
        >
          Refresh
        </button>
      </div>
      <div className="business-tabs" role="tablist" aria-label="Business modules">
        {visibleTabs.map(([id, label]) => (
          <button
            key={id}
            id={`tab-${id}`}
            type="button"
            role="tab"
            aria-selected={activeTab === id}
            aria-controls="business-panel"
            className={activeTab === id ? "business-tab active" : "business-tab"}
            onClick={() => {
              setActiveTab(id);
              setNotice("");
              setEditingContactId(null);
            }}
          >
            {label}
          </button>
        ))}
      </div>
      {error && (
        <div className="alert error" role="alert">
          {error}
        </div>
      )}
      {notice && (
        <div className="alert success" role="status">
          {notice}
        </div>
      )}
      <div
        id="business-panel"
        role="tabpanel"
        aria-labelledby={`tab-${activeTab}`}
        className="business-panel"
      >
        {visibleTabs.length === 0 ? (
          <p className="business-state">
            Your role has no business module read permissions.
          </p>
        ) : loading ? (
          <p className="business-state" role="status">
            Loading {activeTab}…
          </p>
        ) : activeTab === "summary" ? (
          <SummaryPanel summary={data as Summary | null} />
        ) : activeTab === "products" ? (
          <ProductsPanel
            products={asArray<Product>(data as Product[] | null)}
            categories={options.categories}
            busy={busy}
            onSubmit={handleSubmit}
            onCommand={runCommand}
            canManage={permissions.includes("catalog.manage")}
            search={productSearch}
            onSearch={setProductSearch}
            includeInactive={includeArchived}
            onIncludeInactive={setIncludeArchived}
          />
        ) : activeTab === "inventory" ? (
          <InventoryPanel
            inventory={data as Inventory | null}
            products={options.products}
            busy={busy}
            onSubmit={handleSubmit}
            canManage={permissions.includes("inventory.manage")}
          />
        ) : activeTab === "customers" ? (
          <ContactsPanel
            title="Customers"
            contacts={asArray<Contact>(data as Contact[] | null)}
            busy={busy}
            onSubmit={handleSubmit}
            path="/business/customers"
            canManage={permissions.includes("customers.manage")}
            editingId={editingContactId}
            setEditingId={setEditingContactId}
          />
        ) : activeTab === "suppliers" ? (
          <ContactsPanel
            title="Suppliers"
            contacts={asArray<Contact>(data as Contact[] | null)}
            busy={busy}
            onSubmit={handleSubmit}
            path="/business/suppliers"
            canManage={permissions.includes("procurement.manage")}
            editingId={editingContactId}
            setEditingId={setEditingContactId}
          />
        ) : activeTab === "sales" ? (
          <SalesPanel
            sales={asArray<Invoice>(data as Invoice[] | null)}
            products={options.products}
            customers={options.customers}
            busy={busy}
            onSubmit={handleSubmit}
            canManage={permissions.includes("sales.manage")}
            canRecordPayments={permissions.includes("payments.manage")}
          />
        ) : activeTab === "purchases" ? (
          <PurchasesPanel
            purchases={asArray<Invoice>(data as Invoice[] | null)}
            products={options.products}
            suppliers={options.suppliers}
            busy={busy}
            onSubmit={handleSubmit}
            canManage={
              permissions.includes("procurement.manage") &&
              permissions.includes("inventory.manage")
            }
            canRecordPayments={permissions.includes("payments.manage")}
          />
        ) : (
          <PaymentsPanel payments={asArray<Payment>(data as Payment[] | null)} />
        )}
      </div>
    </section>
  );
}

type SubmitHandler = (
  event: FormEvent<HTMLFormElement>,
  path: string,
  build: (form: FormData) => Record<string, unknown>,
  message: string,
  method?: "POST" | "PATCH",
) => void;

/** Bodyless action (archive/restore) that still reports its own errors. */
type CommandHandler = (path: string, message: string) => Promise<void>;

function EmptyState({ label }: { label: string }) {
  return <p className="business-empty">No {label.toLowerCase()} to show yet.</p>;
}

/**
 * Panels must never assume the array shape: a tab switch briefly reuses the
 * previous payload (or a pagination envelope) while the next fetch is in flight.
 * This keeps rendering total instead of throwing during that window.
 */
function asArray<T>(value: T[] | { items?: T[] } | null | undefined): T[] {
  if (Array.isArray(value)) return value;
  return Array.isArray(value?.items) ? value.items : [];
}

function SummaryPanel({ summary }: { summary: Summary | null }) {
  if (!summary) return <EmptyState label="Business report" />;
  const lowStock = Array.isArray(summary.lowStockProducts)
    ? summary.lowStockProducts
    : [];
  const cards: Array<[string, string]> = [
    ["Sales invoiced", summary.salesTotal],
    ["Customer balances", summary.customerOutstanding],
    ["Purchases received", summary.purchasesTotal],
    ["Supplier balances", summary.supplierOutstanding],
    ["Units in stock", String(summary.inventoryUnits)],
    ["Inventory at cost", summary.inventoryCostValue],
  ];
  return (
    <>
      <div className="business-metrics">
        {cards.map(([label, amount]) => (
          <article className="business-metric" key={label}>
            <span>{label}</span>
            <strong>{amount}</strong>
          </article>
        ))}
      </div>
      <h3 className="business-subheading">Low-stock products</h3>
      {lowStock.length === 0 ? (
        <EmptyState label="Low-stock products" />
      ) : (
        <div className="business-table-wrap">
          <table className="business-table">
            <thead>
              <tr>
                <th>Product</th>
                <th>Units remaining</th>
              </tr>
            </thead>
            <tbody>
              {lowStock.map((item, index) => (
                <tr key={`${item.name}-${index}`}>
                  <td>{item.name}</td>
                  <td>{item.quantity}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

function ProductsPanel({
  products,
  categories,
  busy,
  onSubmit,
  onCommand,
  canManage,
  search,
  onSearch,
  includeInactive,
  onIncludeInactive,
}: {
  products: Product[];
  categories: Category[];
  busy: boolean;
  canManage: boolean;
  onSubmit: SubmitHandler;
  onCommand: CommandHandler;
  search: string;
  onSearch: (value: string) => void;
  includeInactive: boolean;
  onIncludeInactive: (value: boolean) => void;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [archiveTarget, setArchiveTarget] = useState<Product | null>(null);
  const editing = products.find((product) => product.id === editingId);

  return (
    <>
      <div className="business-toolbar">
        <label className="business-inline-fields">
          Search catalog
          <input
            type="search"
            aria-label="Search products"
            placeholder="Name, SKU or barcode"
            maxLength={120}
            value={search}
            onChange={(event) => onSearch(event.target.value)}
          />
        </label>
        <label className="business-checkbox">
          <input
            type="checkbox"
            checked={includeInactive}
            onChange={(event) => onIncludeInactive(event.target.checked)}
          />
          Include archived
        </label>
      </div>
      {canManage && (
        <div className="business-form-grid">
          <form
            className="business-form"
            onSubmit={(event) =>
              onSubmit(
                event,
                "/business/categories",
                (form) => ({ name: String(form.get("name") ?? "") }),
                "Category created.",
              )
            }
          >
            <h3>Add category</h3>
            <label>
              Category name
              <input name="name" required maxLength={120} />
            </label>
            <button className="secondary-button" disabled={busy}>
              Add category
            </button>
          </form>
          <form
            className="business-form"
            onSubmit={(event) =>
              onSubmit(
                event,
                "/business/products",
                (form) => {
                  const lowStockAt = String(form.get("lowStockAt") ?? "").trim();
                  return {
                    name: String(form.get("name") ?? ""),
                    sku: optional(form.get("sku")),
                    categoryId: optional(form.get("categoryId")),
                    unitPrice: String(form.get("unitPrice") ?? ""),
                    costPrice: String(form.get("costPrice") ?? ""),
                    lowStockAt: lowStockAt ? Number(lowStockAt) : 5,
                  };
                },
                "Product created.",
              )
            }
          >
            <h3>Add product</h3>
            <label>
              Product name
              <input name="name" required maxLength={160} />
            </label>
            <label>
              SKU
              <input name="sku" maxLength={80} />
            </label>
            <label>
              Category
              <select name="categoryId" defaultValue="">
                <option value="">Uncategorised</option>
                {categories.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                ))}
              </select>
            </label>
            <div className="business-inline-fields">
              <label>
                Selling price
                <input
                  name="unitPrice"
                  inputMode="decimal"
                  pattern="(?:0|[1-9][0-9]{0,11})(?:\.[0-9]{1,2})?"
                  required
                />
              </label>
              <label>
                Unit cost
                <input
                  name="costPrice"
                  inputMode="decimal"
                  pattern="(?:0|[1-9][0-9]{0,11})(?:\.[0-9]{1,2})?"
                  required
                />
              </label>
            </div>
            <label>
              Low-stock alert at
              <input name="lowStockAt" type="number" min={0} defaultValue={5} />
            </label>
            <button className="secondary-button" disabled={busy}>
              Create product
            </button>
          </form>
          {editing && (
            <form
              className="business-form"
              onSubmit={(event) =>
                onSubmit(
                  event,
                  `/business/products/${editing.id}`,
                  (form) => {
                    const lowStockAt = String(form.get("lowStockAt") ?? "").trim();
                    return {
                      name: String(form.get("name") ?? ""),
                      sku: String(form.get("sku") ?? "").trim() || null,
                      categoryId: String(form.get("categoryId") ?? "").trim() || null,
                      unitPrice: String(form.get("unitPrice") ?? ""),
                      costPrice: String(form.get("costPrice") ?? ""),
                      lowStockAt: lowStockAt ? Number(lowStockAt) : 5,
                    };
                  },
                  "Product updated.",
                  "PATCH",
                )
              }
            >
              <h3>Edit product</h3>
              <label>
                Product name
                <input
                  name="name"
                  required
                  maxLength={160}
                  defaultValue={editing.name}
                />
              </label>
              <label>
                SKU
                <input name="sku" maxLength={80} defaultValue={editing.sku ?? ""} />
              </label>
              <label>
                Category
                <select
                  name="categoryId"
                  defaultValue={editing.category?.id ?? ""}
                >
                  <option value="">Uncategorised</option>
                  {categories.map((category) => (
                    <option key={category.id} value={category.id}>
                      {category.name}
                    </option>
                  ))}
                </select>
              </label>
              <div className="business-inline-fields">
                <label>
                  Selling price
                  <input
                    name="unitPrice"
                    inputMode="decimal"
                    pattern="(?:0|[1-9][0-9]{0,11})(?:\.[0-9]{1,2})?"
                    required
                    defaultValue={editing.unitPrice}
                  />
                </label>
                <label>
                  Unit cost
                  <input
                    name="costPrice"
                    inputMode="decimal"
                    pattern="(?:0|[1-9][0-9]{0,11})(?:\.[0-9]{1,2})?"
                    required
                    defaultValue={editing.costPrice}
                  />
                </label>
              </div>
              <label>
                Low-stock alert at
                <input
                  name="lowStockAt"
                  type="number"
                  min={0}
                  defaultValue={editing.lowStockAt}
                />
              </label>
              <button
                type="button"
                className="secondary-button"
                onClick={() => setEditingId(null)}
              >
                Cancel
              </button>
              <button className="secondary-button" disabled={busy}>
                Save changes
              </button>
            </form>
          )}
        </div>
      )}
      {products.length === 0 ? (
        <EmptyState
          label={search.trim() ? `products matching “${search.trim()}”` : "Products"}
        />
      ) : (
        <div className="business-table-wrap">
          <table className="business-table">
            <caption className="sr-only">
              {products.length} product{products.length === 1 ? "" : "s"}
              {includeInactive ? " including archived" : ""}
            </caption>
            <thead>
              <tr>
                <th scope="col">Product</th>
                <th scope="col">SKU</th>
                <th scope="col">Category</th>
                <th scope="col">Price</th>
                <th scope="col">Stock</th>
                <th scope="col">Status</th>
                {canManage && <th scope="col">Actions</th>}
              </tr>
            </thead>
            <tbody>
              {products.map((product) => (
                <tr key={product.id} className={product.isActive ? undefined : "is-inactive"}>
                  <td>{product.name}</td>
                  <td>{product.sku || "—"}</td>
                  <td>{product.category?.name || "—"}</td>
                  <td>{product.unitPrice}</td>
                  <td>{product.inventory?.quantity ?? 0}</td>
                  <td>{product.isActive ? "Active" : "Archived"}</td>
                  {canManage && (
                    <td className="business-row-actions">
                      {product.isActive ? (
                        <>
                          <button
                            type="button"
                            className="secondary-button"
                            aria-expanded={editingId === product.id}
                            onClick={() =>
                              setEditingId(
                                editingId === product.id ? null : product.id,
                              )
                            }
                          >
                            {editingId === product.id ? "Cancel edit" : `Edit ${product.name}`}
                          </button>
                          <button
                            type="button"
                            className="secondary-button"
                            disabled={busy}
                            onClick={() => setArchiveTarget(product)}
                          >
                            Archive
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          className="secondary-button"
                          disabled={busy}
                          onClick={() =>
                            void onCommand(
                              `/business/products/${product.id}/restore`,
                              `Restored ${product.name}.`,
                            )
                          }
                        >
                          Restore
                        </button>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {archiveTarget && (
        <div
          className="business-confirm"
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="archive-product-title"
        >
          <h3 id="archive-product-title">Archive “{archiveTarget.name}”?</h3>
          <p>
            Archived products keep their history and stock records but leave the
            active catalog. You can restore it later from “Include archived”.
          </p>
          <div className="business-row-actions">
            <button
              type="button"
              className="secondary-button"
              autoFocus
              onClick={() => setArchiveTarget(null)}
            >
              Keep active
            </button>
            <button
              type="button"
              className="secondary-button"
              disabled={busy}
              onClick={() => {
                const target = archiveTarget;
                setArchiveTarget(null);
                void onCommand(
                  `/business/products/${target.id}/archive`,
                  `Archived ${target.name}.`,
                );
              }}
            >
              Archive product
            </button>
          </div>
        </div>
      )}
    </>
  );
}

function InventoryPanel({
  inventory,
  products,
  busy,
  onSubmit,
  canManage,
}: {
  inventory: Inventory | null;
  products: Product[];
  busy: boolean;
  canManage: boolean;
  onSubmit: SubmitHandler;
}) {
  const stockItems = Array.isArray(inventory?.items) ? inventory.items : [];
  const movements = Array.isArray(inventory?.recentMovements)
    ? inventory.recentMovements
    : [];
  return (
    <>
      {canManage && (
        <form
          className="business-form business-form-inline"
          onSubmit={(event) =>
            onSubmit(
              event,
              "/business/inventory/adjustments",
              (form) => ({
                productId: String(form.get("productId") ?? ""),
                quantityDelta: Number(form.get("quantityDelta") ?? 0),
                reason: String(form.get("reason") ?? "count"),
                note: optional(form.get("note")),
              }),
              "Stock adjustment recorded.",
            )
          }
        >
          <h3>Adjust stock</h3>
          <label>
            Product
            <select name="productId" required defaultValue="">
              <option value="" disabled>
                Select product
              </option>
              {products.map((product) => (
                <option key={product.id} value={product.id}>
                  {product.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Change in units
            <input
              name="quantityDelta"
              type="number"
              min={-1000000}
              max={1000000}
              required
            />
          </label>
          <label>
            Reason
            <select name="reason">
              <option value="count">Count</option>
              <option value="damage">Damage</option>
              <option value="correction">Correction</option>
            </select>
          </label>
          <label>
            Note
            <input name="note" maxLength={500} />
          </label>
          <button className="secondary-button" disabled={busy}>
            Record adjustment
          </button>
        </form>
      )}
      <h3 className="business-subheading">Current stock</h3>
      {!stockItems.length ? (
        <EmptyState label="Inventory" />
      ) : (
        <div className="business-table-wrap">
          <table className="business-table">
            <thead>
              <tr>
                <th>Product</th>
                <th>SKU</th>
                <th>Available</th>
                <th>Alert threshold</th>
              </tr>
            </thead>
            <tbody>
              {stockItems.map(({ product, quantity }) => (
                <tr key={product.id}>
                  <td>{product.name}</td>
                  <td>{product.sku || "—"}</td>
                  <td>{quantity}</td>
                  <td>{product.lowStockAt}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <h3 className="business-subheading">Recent stock movements</h3>
      {!movements.length ? (
        <EmptyState label="Stock movements" />
      ) : (
        <div className="business-table-wrap">
          <table className="business-table">
            <thead>
              <tr>
                <th>When</th>
                <th>Product</th>
                <th>Reason</th>
                <th>Change</th>
              </tr>
            </thead>
            <tbody>
              {movements.map((movement) => (
                <tr key={movement.id}>
                  <td>{new Date(movement.createdAt).toLocaleString()}</td>
                  <td>{movement.product.name}</td>
                  <td>{movement.reason}</td>
                  <td>
                    {movement.quantityDelta > 0 ? "+" : ""}
                    {movement.quantityDelta}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

function ContactsPanel({
  title,
  contacts,
  busy,
  onSubmit,
  path,
  canManage,
  editingId,
  setEditingId,
}: {
  title: "Customers" | "Suppliers";
  contacts: Contact[];
  busy: boolean;
  path: string;
  canManage: boolean;
  editingId: string | null;
  setEditingId: (id: string | null) => void;
  onSubmit: SubmitHandler;
}) {
  const singular = title.slice(0, -1);
  const editing = contacts.find((contact) => contact.id === editingId);

  return (
    <>
      {canManage && (
        <form
          className="business-form business-form-inline"
          onSubmit={(event) =>
            onSubmit(
              event,
              path,
              (form) => ({
                name: String(form.get("name") ?? ""),
                email: optional(form.get("email")),
                phone: optional(form.get("phone")),
                notes: optional(form.get("notes")),
              }),
              `${singular} created.`,
            )
          }
        >
          <h3>Add {singular.toLowerCase()}</h3>
          <label>
            Name
            <input name="name" required maxLength={160} />
          </label>
          <label>
            Email
            <input name="email" type="email" maxLength={320} />
          </label>
          <label>
            Phone
            <input name="phone" maxLength={40} />
          </label>
          <label>
            Notes
            <input name="notes" maxLength={1000} />
          </label>
          <button className="secondary-button" disabled={busy}>
            Create {singular.toLowerCase()}
          </button>
        </form>
      )}
      {canManage && editing && (
        <form
          className="business-form"
          onSubmit={(event) =>
            onSubmit(
              event,
              `${path}/${editing.id}`,
              (form) => ({
                name: String(form.get("name") ?? "").trim() || editing.name,
                email: clearable(form.get("email"), editing.email),
                phone: clearable(form.get("phone"), editing.phone),
                notes: clearable(form.get("notes"), editing.notes),
              }),
              `${singular} updated.`,
              "PATCH",
            )
          }
        >
          <h3>Edit {singular.toLowerCase()}</h3>
          <label>
            Name
            <input name="name" required maxLength={160} defaultValue={editing.name} />
          </label>
          <label>
            Email
            <input
              name="email"
              type="email"
              maxLength={320}
              defaultValue={editing.email ?? ""}
            />
          </label>
          <label>
            Phone
            <input name="phone" maxLength={40} defaultValue={editing.phone ?? ""} />
          </label>
          <label>
            Notes
            <input name="notes" maxLength={1000} defaultValue={editing.notes ?? ""} />
          </label>
          <p className="field-hint">Leave a field empty to clear it.</p>
          <button
            type="button"
            className="secondary-button"
            onClick={() => setEditingId(null)}
          >
            Cancel
          </button>
          <button className="secondary-button" disabled={busy}>
            Save changes
          </button>
        </form>
      )}
      {contacts.length === 0 ? (
        <EmptyState label={title} />
      ) : (
        <div className="business-table-wrap">
          <table className="business-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Phone</th>
                {canManage && <th>Actions</th>}
              </tr>
            </thead>
            <tbody>
              {contacts.map((contact) => (
                <tr key={contact.id}>
                  <td>{contact.name}</td>
                  <td>{contact.email || "—"}</td>
                  <td>{contact.phone || "—"}</td>
                  {canManage && (
                    <td>
                      <button
                        className="secondary-button"
                        onClick={() =>
                          setEditingId(editingId === contact.id ? null : contact.id)
                        }
                      >
                        {editingId === contact.id ? "Cancel" : "Edit"}
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

type LineRow = { key: number; productId: string; quantity: string; unitCost: string };

function LineEditor({
  rows,
  setRows,
  products,
  withCost,
}: {
  rows: LineRow[];
  setRows: (rows: LineRow[]) => void;
  products: Product[];
  withCost: boolean;
}) {
  const update = (key: number, patch: Partial<LineRow>) =>
    setRows(rows.map((row) => (row.key === key ? { ...row, ...patch } : row)));

  return (
    <>
      {rows.map((row, index) => (
        <fieldset className="business-line" key={row.key}>
          <legend>Line {index + 1}</legend>
          <label>
            Product {index + 1}
            <select
              name={`productId-${index}`}
              required
              value={row.productId}
              onChange={(event) => update(row.key, { productId: event.target.value })}
            >
              <option value="" disabled>
                Select product
              </option>
              {products.map((product) => (
                <option key={product.id} value={product.id}>
                  {product.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Quantity
            <input
              name={`quantity-${index}`}
              type="number"
              min={1}
              max={1000000}
              required
              value={row.quantity}
              onChange={(event) => update(row.key, { quantity: event.target.value })}
            />
          </label>
          {withCost && (
            <label>
              Unit cost
              <input
                name={`unitCost-${index}`}
                inputMode="decimal"
                pattern="(?:0|[1-9][0-9]{0,11})(?:\.[0-9]{1,2})?"
                required
                value={row.unitCost}
                onChange={(event) => update(row.key, { unitCost: event.target.value })}
              />
            </label>
          )}
          {rows.length > 1 && (
            <button
              type="button"
              className="secondary-button"
              onClick={() => setRows(rows.filter((item) => item.key !== row.key))}
            >
              Remove line
            </button>
          )}
        </fieldset>
      ))}
      {rows.length < 100 && (
        <button
          type="button"
          className="secondary-button"
          onClick={() =>
            setRows([
              ...rows,
              { key: Date.now() + rows.length, productId: "", quantity: "1", unitCost: "" },
            ])
          }
        >
          Add line
        </button>
      )}
    </>
  );
}

function InvoiceDetails({ invoice }: { invoice: Invoice }) {
  const lines = Array.isArray(invoice.items) ? invoice.items : [];
  const payments = Array.isArray(invoice.payments) ? invoice.payments : [];
  return (
    <details className="business-invoice-details">
      <summary>View details</summary>
      <h4>Lines</h4>
      {lines.length ? (
        <ul>
          {lines.map((line) => (
            <li key={line.id}>
              · {line.quantity} × {line.unitPrice ?? line.unitCost} = {line.lineTotal}
            </li>
          ))}
        </ul>
      ) : (
        <p>No lines.</p>
      )}
      <h4>Payments</h4>
      {payments.length ? (
        <ul>
          {payments.map((payment) => (
            <li key={payment.id}>
              {payment.paidAt.slice(0, 10)} · {payment.amount} · {payment.method}
              {payment.reference ? ` · ${payment.reference}` : ""}
            </li>
          ))}
        </ul>
      ) : (
        <p>No payments recorded.</p>
      )}
    </details>
  );
}

function outstandingOnly(invoices: Invoice[]): Invoice[] {
  return invoices.filter((invoice) => Number(invoice.outstanding) > 0);
}

function SalesPanel({
  sales,
  products,
  customers,
  busy,
  onSubmit,
  canManage,
  canRecordPayments,
}: {
  sales: Invoice[];
  products: Product[];
  customers: Contact[];
  busy: boolean;
  canManage: boolean;
  canRecordPayments: boolean;
  onSubmit: SubmitHandler;
}) {
  const [lines, setLines] = useState<LineRow[]>([
    { key: 1, productId: "", quantity: "1", unitCost: "" },
  ]);
  const payable = outstandingOnly(sales);

  return (
    <>
      {canManage && (
        <form
          className="business-form"
          onSubmit={(event) =>
            onSubmit(
              event,
              "/business/sales",
              (form) => ({
                customerId: optional(form.get("customerId")),
                items: lines.map((_, index) => ({
                  productId: String(form.get(`productId-${index}`) ?? ""),
                  quantity: Number(form.get(`quantity-${index}`) ?? 1),
                })),
                tax: String(form.get("tax") ?? "0"),
                discount: String(form.get("discount") ?? "0"),
              }),
              "Sales invoice created and stock movements recorded.",
            )
          }
        >
          <h3>Create sales invoice</h3>
          <label>
            Customer
            <select name="customerId" defaultValue="">
              <option value="">Walk-in customer</option>
              {customers.map((customer) => (
                <option key={customer.id} value={customer.id}>
                  {customer.name}
                </option>
              ))}
            </select>
          </label>
          <LineEditor
            rows={lines}
            setRows={setLines}
            products={products.filter((product) => product.isActive !== false)}
            withCost={false}
          />
          <div className="business-inline-fields">
            <label>
              Discount
              <input
                name="discount"
                inputMode="decimal"
                defaultValue="0"
                pattern="(?:0|[1-9][0-9]{0,11})(?:\.[0-9]{1,2})?"
              />
            </label>
            <label>
              Tax
              <input
                name="tax"
                inputMode="decimal"
                defaultValue="0"
                pattern="(?:0|[1-9][0-9]{0,11})(?:\.[0-9]{1,2})?"
              />
            </label>
          </div>
          <button
            className="secondary-button"
            disabled={busy || products.length === 0}
          >
            Create invoice
          </button>
        </form>
      )}
      <h3 className="business-subheading">Sales invoices</h3>
      {sales.length === 0 ? (
        <EmptyState label="Sales invoices" />
      ) : (
        <div className="business-table-wrap">
          <table className="business-table">
            <thead>
              <tr>
                <th>Invoice</th>
                <th>Customer</th>
                <th>Total</th>
                <th>Outstanding</th>
                <th>Details</th>
              </tr>
            </thead>
            <tbody>
              {sales.map((sale) => (
                <tr key={sale.id}>
                  <td>{sale.invoiceNumber}</td>
                  <td>{sale.customer?.name || "Walk-in"}</td>
                  <td>{sale.total}</td>
                  <td>{sale.outstanding}</td>
                  <td>
                    <InvoiceDetails invoice={sale} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {canRecordPayments && payable.length > 0 && (
        <form
          className="business-form business-form-inline"
          onSubmit={(event) =>
            onSubmit(
              event,
              "/business/payments",
              (form) => ({
                saleId: String(form.get("saleId") ?? ""),
                amount: String(form.get("amount") ?? ""),
                method: String(form.get("method") ?? ""),
                reference: optional(form.get("reference")),
              }),
              "Customer payment recorded.",
            )
          }
        >
          <h3>Record customer payment</h3>
          <label>
            Invoice
            <select name="saleId" required defaultValue="">
              <option value="" disabled>
                Select invoice
              </option>
              {payable.map((sale) => (
                <option key={sale.id} value={sale.id}>
                  {sale.invoiceNumber} · due {sale.outstanding}
                </option>
              ))}
            </select>
          </label>
          <label>
            Amount
            <input name="amount" inputMode="decimal" pattern="[0-9]+\.[0-9]{2}" required />
          </label>
          <label>
            Method
            <select name="method">
              <option value="cash">Cash</option>
              <option value="card">Card</option>
              <option value="bank_transfer">Bank transfer</option>
              <option value="other">Other</option>
            </select>
          </label>
          <label>
            Reference
            <input name="reference" maxLength={100} />
          </label>
          <button className="secondary-button" disabled={busy}>
            Record payment
          </button>
        </form>
      )}
    </>
  );
}

function PurchasesPanel({
  purchases,
  products,
  suppliers,
  busy,
  onSubmit,
  canManage,
  canRecordPayments,
}: {
  purchases: Invoice[];
  products: Product[];
  suppliers: Contact[];
  busy: boolean;
  canManage: boolean;
  canRecordPayments: boolean;
  onSubmit: SubmitHandler;
}) {
  const [lines, setLines] = useState<LineRow[]>([
    { key: 1, productId: "", quantity: "1", unitCost: "" },
  ]);
  const payable = outstandingOnly(purchases);

  return (
    <>
      {canManage && (
        <form
          className="business-form"
          onSubmit={(event) =>
            onSubmit(
              event,
              "/business/purchases",
              (form) => ({
                supplierId: String(form.get("supplierId") ?? ""),
                invoiceNumber: String(form.get("invoiceNumber") ?? ""),
                items: lines.map((_, index) => ({
                  productId: String(form.get(`productId-${index}`) ?? ""),
                  quantity: Number(form.get(`quantity-${index}`) ?? 1),
                  unitCost: String(form.get(`unitCost-${index}`) ?? ""),
                })),
                tax: String(form.get("tax") ?? "0"),
              }),
              "Purchase invoice recorded and stock received.",
            )
          }
        >
          <h3>Receive purchase invoice</h3>
          <label>
            Supplier
            <select name="supplierId" required defaultValue="">
              <option value="" disabled>
                Select supplier
              </option>
              {suppliers.map((supplier) => (
                <option key={supplier.id} value={supplier.id}>
                  {supplier.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Supplier invoice number
            <input name="invoiceNumber" required maxLength={80} />
          </label>
          <LineEditor rows={lines} setRows={setLines} products={products} withCost />
          <label>
            Tax
            <input
              name="tax"
              inputMode="decimal"
              defaultValue="0"
              pattern="(?:0|[1-9][0-9]{0,11})(?:\.[0-9]{1,2})?"
            />
          </label>
          <button
            className="secondary-button"
            disabled={busy || products.length === 0 || suppliers.length === 0}
          >
            Receive invoice
          </button>
        </form>
      )}
      <h3 className="business-subheading">Purchase invoices</h3>
      {purchases.length === 0 ? (
        <EmptyState label="Purchase invoices" />
      ) : (
        <div className="business-table-wrap">
          <table className="business-table">
            <thead>
              <tr>
                <th>Invoice</th>
                <th>Supplier</th>
                <th>Total</th>
                <th>Outstanding</th>
                <th>Details</th>
              </tr>
            </thead>
            <tbody>
              {purchases.map((invoice) => (
                <tr key={invoice.id}>
                  <td>{invoice.invoiceNumber}</td>
                  <td>{invoice.supplier?.name}</td>
                  <td>{invoice.total}</td>
                  <td>{invoice.outstanding}</td>
                  <td>
                    <InvoiceDetails invoice={invoice} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {canRecordPayments && payable.length > 0 && (
        <form
          className="business-form business-form-inline"
          onSubmit={(event) =>
            onSubmit(
              event,
              "/business/payments",
              (form) => ({
                purchaseInvoiceId: String(form.get("purchaseInvoiceId") ?? ""),
                amount: String(form.get("amount") ?? ""),
                method: String(form.get("method") ?? ""),
                reference: optional(form.get("reference")),
              }),
              "Supplier payment recorded.",
            )
          }
        >
          <h3>Record supplier payment</h3>
          <label>
            Invoice
            <select name="purchaseInvoiceId" required defaultValue="">
              <option value="" disabled>
                Select invoice
              </option>
              {payable.map((invoice) => (
                <option key={invoice.id} value={invoice.id}>
                  {invoice.invoiceNumber} · due {invoice.outstanding}
                </option>
              ))}
            </select>
          </label>
          <label>
            Amount
            <input name="amount" inputMode="decimal" pattern="[0-9]+\.[0-9]{2}" required />
          </label>
          <label>
            Method
            <select name="method">
              <option value="cash">Cash</option>
              <option value="card">Card</option>
              <option value="bank_transfer">Bank transfer</option>
              <option value="other">Other</option>
            </select>
          </label>
          <label>
            Reference
            <input name="reference" maxLength={100} />
          </label>
          <button className="secondary-button" disabled={busy}>
            Record payment
          </button>
        </form>
      )}
    </>
  );
}

function PaymentsPanel({ payments }: { payments: Payment[] }) {
  if (payments.length === 0) return <EmptyState label="Payments" />;
  return (
    <div className="business-table-wrap">
      <table className="business-table">
        <thead>
          <tr>
            <th>Paid at</th>
            <th>Method</th>
            <th>Amount</th>
            <th>Reference</th>
            <th>Related invoice</th>
          </tr>
        </thead>
        <tbody>
          {payments.map((payment) => {
            const related = payment.sale ?? payment.purchaseInvoice;
            const methodLabel =
              payment.method.charAt(0).toUpperCase() +
              payment.method.slice(1).replace(/_/g, " ");
            return (
              <tr key={payment.id}>
                <td>{new Date(payment.paidAt).toLocaleString()}</td>
                <td>{methodLabel}</td>
                <td>{payment.amount}</td>
                <td>{payment.reference ?? "—"}</td>
                <td>
                  {related
                    ? `${payment.sale ? "Sale" : "Purchase"}: ${related.invoiceNumber}`
                    : "—"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
