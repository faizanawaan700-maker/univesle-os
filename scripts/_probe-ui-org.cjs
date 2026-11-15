/* Read-only: did the browser QA run actually persist a product? */
const path = require("node:path");
require(path.join(__dirname, "..", "apps", "api", "node_modules", "dotenv")).config({
  path: path.join(__dirname, "..", ".env"),
  quiet: true,
});
const { database } = require(
  path.join(__dirname, "..", "packages", "database", "dist", "index.js"),
);

(async () => {
  const org = await database.organization.findFirst({
    where: { name: { startsWith: "UI QA Org" } },
    orderBy: { createdAt: "desc" },
  });
  if (!org) {
    console.log("no UI QA org found");
    return;
  }
  const products = await database.product.findMany({
    where: { organizationId: org.id },
    select: {
      id: true,
      name: true,
      sku: true,
      isActive: true,
      createdAt: true,
    },
  });
  const audit = await database.auditLog.findMany({
    where: { organizationId: org.id },
    select: { action: true, entityType: true, createdAt: true },
    orderBy: { createdAt: "desc" },
    take: 10,
  });
  console.log(JSON.stringify({ org: org.name, products, audit }, null, 2));
  await database.$disconnect();
})().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
