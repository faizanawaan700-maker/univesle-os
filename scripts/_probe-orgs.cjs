/* Read-only probe: list recent disposable orgs left behind by integration runs. */
const path = require("node:path");
require(path.join(__dirname, "..", "apps", "api", "node_modules", "dotenv")).config({
  path: path.join(__dirname, "..", ".env"),
});
const { database: p } = require(
  path.join(__dirname, "..", "packages", "database", "dist", "index.js"),
);

(async () => {
  const orgs = await p.organization.findMany({
    orderBy: { createdAt: "desc" },
    take: 8,
    select: {
      id: true,
      name: true,
      createdAt: true,
      _count: { select: { members: true, roles: true } },
    },
  });
  console.log("recent orgs:", JSON.stringify(orgs, null, 2));
  await p.$disconnect();
})().catch(async (e) => {
  console.error(e.message);
  process.exit(1);
});
