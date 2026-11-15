// Temporary probe: does a sale deduct stock and post the discount correctly?
const API = "http://127.0.0.1:4000";
const ORIGIN = "http://127.0.0.1:3000";

(async () => {
  const reg = await fetch(`${API}/auth/register`, {
    method: "POST",
    headers: { origin: ORIGIN, "content-type": "application/json" },
    body: JSON.stringify({
      email: `probe-sale-${Date.now()}@example.com`,
      password: "probe-sale-password",
      name: "Probe",
      organizationName: `Probe Sale ${Date.now()}`,
    }),
  });
  if (reg.status !== 201) return console.log("register", reg.status);
  const cookie = (reg.headers.get("set-cookie") ?? "").split(";")[0];
  const org = (await reg.json()).user.organizations[0].id;
  const h = (extra = {}) => ({
    origin: ORIGIN,
    cookie,
    "x-organization-id": org,
    ...extra,
  });

  const product = await (
    await fetch(`${API}/business/products`, {
      method: "POST",
      headers: h({ "content-type": "application/json" }),
      body: JSON.stringify({
        name: "Probe P",
        unitPrice: "50.00",
        costPrice: "20.00",
      }),
    })
  ).json();

  await fetch(`${API}/business/inventory/adjustments`, {
    method: "POST",
    headers: h({
      "content-type": "application/json",
      "idempotency-key": "probe-adj-1",
    }),
    body: JSON.stringify({
      productId: product.id,
      quantityDelta: 10,
      reason: "count",
    }),
  });

  const stock1 = await (
    await fetch(`${API}/business/inventory`, { headers: h() })
  ).json();
  console.log(
    "stock before",
    stock1.items.find((i) => i.productId === product.id)?.quantity,
  );

  const saleRes = await fetch(`${API}/business/sales`, {
    method: "POST",
    headers: h({
      "content-type": "application/json",
      "idempotency-key": "probe-sale-1",
    }),
    body: JSON.stringify({
      items: [{ productId: product.id, quantity: 4 }],
      tax: "3.00",
      discount: "5.00",
    }),
  });
  const sale = await saleRes.json();
  console.log(
    "sale",
    saleRes.status,
    JSON.stringify({
      total: sale.total,
      subtotal: sale.subtotal,
      discount: sale.discount,
      tax: sale.tax,
    }),
  );

  const stock2 = await (
    await fetch(`${API}/business/inventory`, { headers: h() })
  ).json();
  console.log(
    "stock after",
    stock2.items.find((i) => i.productId === product.id)?.quantity,
  );

  const trial = await (
    await fetch(`${API}/business/accounting/trial-balance`, { headers: h() })
  ).json();
  console.log(
    "ledger",
    trial.accounts
      .filter((a) => Number(a.debit) > 0 || Number(a.credit) > 0)
      .map((a) => `${a.code}:D${a.debit}/C${a.credit}`)
      .join(" "),
  );
})();
