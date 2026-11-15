/* Browser QA for the Products UI: login -> products -> create -> search -> edit
 * -> reload -> archive -> restore. Returns evidence, not assertions of intent. */
export default async function run(page, ui) {
  const out = { steps: [] };
  const name = `UI Product ${Date.now()}`;
  const renamed = `${name} Edited`;

  await page.goto("http://localhost:3000/", { waitUntil: "domcontentloaded" });

  let snap = await ui.snapshot();
  out.steps.push({ step: "landing", snap: snap.slice(0, 1200) });

  // Register a disposable account if the landing page offers it.
  const signUp = snap.match(/@(e\d+) (?:link|button) "([^"]*[Ss]ign up[^"]*)"/)?.[1];
  if (signUp) {
    await ui.click(signUp);
    await page.waitForTimeout(800);
    snap = await ui.snapshot();
    out.steps.push({ step: "after-signup-click", snap: snap.slice(0, 1500) });
  }

  const email = `ui.qa.${Date.now()}@example.com`;
  const fill = async (label, value) => {
    const ref = (await ui.snapshot()).match(
      new RegExp(`@(e\\d+) [^\\n]*"${label}"`),
    )?.[1];
    if (!ref) return false;
    await ui.fill(ref, value);
    return true;
  };

  const registered = { email };
  registered.name = await fill("Full name", "UI QA");
  registered.email = await fill("Email", email);
  registered.org = await fill("Organization name", `UI QA Org ${Date.now()}`);
  registered.password = await fill("Password", "ui-qa-password-12345");

  snap = await ui.snapshot();
  const submit = snap.match(/@(e\d+) button "(?:Create account|Sign up|Register)"/)?.[1];
  if (submit) {
    await ui.click(submit);
    await page.waitForTimeout(3000);
  }
  out.steps.push({ step: "after-register", registered, url: page.url() });

  snap = await ui.snapshot();
  const productsTab = snap.match(/@(e\d+) (?:button|tab|link) "Products"/)?.[1];
  out.steps.push({ step: "products-tab", found: Boolean(productsTab) });
  if (!productsTab) return { ...out, snap };

  await ui.click(productsTab);
  await page.waitForTimeout(1500);

  const setField = async (label, value) => {
    const ref = (await ui.snapshot()).match(
      new RegExp(`@(e\\d+) [^\\n]*"${label}"`),
    )?.[1];
    if (!ref) return false;
    await ui.fill(ref, value);
    return true;
  };

  out.steps.push({
    step: "create-form",
    name: await setField("Product name", name),
    sku: await setField("SKU", `UI-${Date.now()}`),
    price: await setField("Selling price", "42.50"),
    cost: await setField("Unit cost", "30.00"),
  });
  const createBtn = (await ui.snapshot()).match(/@(e\d+) button "Create product"/)?.[1];
  if (createBtn) {
    await ui.click(createBtn);
    await page.waitForTimeout(2500);
  }

  out.steps.push({ step: "after-create", hasRow: (await ui.snapshot({ full: true })).includes(name) });

  // Search
  await setField("Search products", name);
  await page.waitForTimeout(1500);
  out.steps.push({ step: "search", hasRow: (await ui.snapshot({ full: true })).includes(name) });

  // Edit
  const editBtn = (await ui.snapshot()).match(/@(e\d+) button "Edit [^"]*"/)?.[1];
  if (editBtn) {
    await ui.click(editBtn);
    await page.waitForTimeout(900);
    await setField("Product name", renamed);
    const saveBtn = (await ui.snapshot()).match(/@(e\d+) button "Save changes"/)?.[1];
    if (saveBtn) await ui.click(saveBtn);
    await page.waitForTimeout(2500);
  }
  out.steps.push({ step: "after-edit", hasRenamed: (await ui.snapshot({ full: true })).includes(renamed) });

  // Reload persistence
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2500);
  snap = await ui.snapshot();
  const tabAfterReload = snap.match(/@(e\d+) (?:button|tab|link) "Products"/)?.[1];
  if (tabAfterReload) {
    await ui.click(tabAfterReload);
    await page.waitForTimeout(2000);
  }
  await setField("Search products", renamed);
  await page.waitForTimeout(1500);
  out.steps.push({
    step: "after-reload",
    persisted: (await ui.snapshot({ full: true })).includes(renamed),
  });

  // Archive
  const archiveBtn = (await ui.snapshot()).match(/@(e\d+) button "Archive"/)?.[1];
  if (archiveBtn) {
    await ui.click(archiveBtn);
    await page.waitForTimeout(700);
    const confirmBtn = (await ui.snapshot()).match(/@(e\d+) button "Archive product"/)?.[1];
    if (confirmBtn) await ui.click(confirmBtn);
    await page.waitForTimeout(2500);
  }
  out.steps.push({ step: "after-archive", visibleInActive: (await ui.snapshot({ full: true })).includes(renamed) });

  // Restore via the archived filter
  const includeArchived = (await ui.snapshot()).match(/@(e\d+) checkbox "Include archived"/)?.[1];
  if (includeArchived) {
    await ui.click(includeArchived);
    await page.waitForTimeout(2000);
  }
  const restoreBtn = (await ui.snapshot()).match(/@(e\d+) button "Restore"/)?.[1];
  if (restoreBtn) {
    await ui.click(restoreBtn);
    await page.waitForTimeout(2500);
  }
  out.steps.push({
    step: "after-restore",
    status: (await ui.snapshot({ full: true })).includes("Active"),
  });

  return out;
}
