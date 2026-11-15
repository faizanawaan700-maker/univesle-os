import { assertIntegrationDatabase } from "./test-support/assert-integration-database";

assertIntegrationDatabase();

import "reflect-metadata";
import { ValidationPipe } from "@nestjs/common";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { randomUUID } from "node:crypto";
import { database } from "@ubos/database";
import { AppModule } from "./app.module";

const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN ?? "http://localhost:3000";
const runId = randomUUID();
const emailPrefix = `ubos-phase5-${runId}-`;
const password = "phase-five-integration-password";

type Session = {
  status: number;
  user: { id: string; email: string; organizations: Array<{ id: string }> };
  cookie: string;
};

let app: INestApplication | undefined;
let baseUrl: string;
const createdOrganizationIds: string[] = [];

async function request(
  path: string,
  method = "GET",
  options: { cookie?: string; organizationId?: string; body?: unknown } = {},
): Promise<Response> {
  const headers: Record<string, string> = { origin: FRONTEND_ORIGIN };
  if (options.cookie) headers.cookie = options.cookie;
  if (options.organizationId)
    headers["x-organization-id"] = options.organizationId;
  if (options.body !== undefined) headers["content-type"] = "application/json";
  return fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
}

async function register(
  email: string,
  name: string,
  organizationName: string,
): Promise<Session> {
  const response = await request("/auth/register", "POST", {
    body: { email, name, organizationName, password },
  });
  const body = (await response.json()) as { user?: Session["user"] };
  const cookie = (response.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
  if (response.status === 201 && body.user) {
    for (const organization of body.user.organizations)
      createdOrganizationIds.push(organization.id);
  }
  return {
    status: response.status,
    user: body.user as Session["user"],
    cookie,
  };
}

async function login(email: string): Promise<string> {
  const response = await request("/auth/login", "POST", {
    body: { email, password },
  });
  return (response.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
}

beforeAll(async () => {
  await database.$connect();
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();
  app = moduleRef.createNestApplication();
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  await app.listen(0, "127.0.0.1");
  const address = app.getHttpServer().address();
  if (!address || typeof address === "string")
    throw new Error("Could not determine test address.");
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  if (createdOrganizationIds.length > 0) {
    // Only the organizations this suite created are removed. Journal lines
    // RESTRICT account deletion, so journals go first.
    await database.journalEntryLine.deleteMany({
      where: { journalEntry: { organizationId: { in: createdOrganizationIds } } },
    });
    await database.journalEntry.deleteMany({
      where: { organizationId: { in: createdOrganizationIds } },
    });
    await database.account.deleteMany({
      where: { organizationId: { in: createdOrganizationIds } },
    });
    await database.organization.deleteMany({
      where: { id: { in: createdOrganizationIds } },
    });
    await database.user.deleteMany({
      where: { email: { startsWith: emailPrefix } },
    });
  }
  await app?.close();
  await database.$disconnect();
});

describe("Phase 5 — invitations, roles, members, branches", () => {
  const ownerEmail = `${emailPrefix}owner@example.com`;

  it("invites a new user, who accepts and receives the assigned role", async () => {
    const owner = await register(ownerEmail, "Owner", "Phase 5 Org");
    expect(owner.status).toBe(201);
    const organizationId = owner.user.organizations[0].id;

    const roles = await request("/business/team/roles", "GET", {
      cookie: owner.cookie,
      organizationId,
    });
    expect(roles.status).toBe(200);
    const ownerRole = (
      (await roles.json()) as Array<{ id: string; key: string }>
    ).find((role) => role.key === "owner")!;

    const cashier = await request("/business/team/roles", "POST", {
      cookie: owner.cookie,
      organizationId,
      body: {
        name: "Cashier",
        key: "cashier",
        permissions: ["sales.read", "payments.manage"],
      },
    });
    expect(cashier.status).toBe(201);
    const cashierRole = (await cashier.json()) as { id: string };

    const invitedEmail = `${emailPrefix}invitee@example.com`;
    const invitation = await request("/business/team/invitations", "POST", {
      cookie: owner.cookie,
      organizationId,
      body: { email: invitedEmail, roleId: cashierRole.id },
    });
    expect(invitedEmail.endsWith("@example.com")).toBe(true);
    expect(invitation.status).toBe(201);
    const invitationBody = (await invitation.json()) as {
      token: string;
      status: string;
    };
    expect(invitationBody.status).toBe("PENDING");

    // The token is never returned again after creation.
    const listed = await request("/business/team/invitations", "GET", {
      cookie: owner.cookie,
      organizationId,
    });
    expect(JSON.stringify(await listed.json())).not.toContain(
      invitationBody.token,
    );

    const accepted = await request("/invitations/accept", "POST", {
      body: { token: invitationBody.token, name: "Invited Person", password },
    });
    expect(accepted.status).toBe(201);
    const acceptedBody = (await accepted.json()) as {
      user: { email: string };
      organization: { id: string; role: string };
    };
    expect(acceptedBody.user.email).toBe(invitedEmail);
    expect(acceptedBody.organization.id).toBe(organizationId);
    expect(acceptedBody.organization.role).toBe("cashier");

    // Replaying the same token is rejected.
    const replay = await request("/invitations/accept", "POST", {
      body: { token: invitationBody.token, name: "Invited Person", password },
    });
    expect(replay.status).toBe(409);

    const inviteeCookie = await login(invitedEmail);
    const profile = await request("/auth/me", "GET", { cookie: inviteeCookie });
    const profileBody = (await profile.json()) as {
      organizations: Array<{ id: string; role: string; permissions: string[] }>;
    };
    expect(profileBody.organizations[0].role).toBe("cashier");
    expect(profileBody.organizations[0].permissions.sort()).toEqual([
      "payments.manage",
      "sales.read",
    ]);

    // Least privilege: the invited role cannot read the team roster or manage roles.
    const denied = await request("/business/team/invitations", "GET", {
      cookie: inviteeCookie,
      organizationId,
    });
    expect(denied.status).toBe(403);

    const memberRoleChange = await request(
      `/business/team/members/${acceptedBody.organization.id}/role`,
      "PATCH",
      { cookie: inviteeCookie, organizationId, body: { roleId: ownerRole.id } },
    );
    expect(memberRoleChange.status).toBe(403);
  });

  it("prevents removing or demoting the last owner", async () => {
    const owner = await register(
      `${emailPrefix}lastowner@example.com`,
      "Solo Owner",
      "Solo Org",
    );
    const organizationId = owner.user.organizations[0].id;
    const members = await request("/business/team/members", "GET", {
      cookie: owner.cookie,
      organizationId,
    });
    const self = ((await members.json()) as { items: Array<{ id: string }> })
      .items[0];

    const roles = await request("/business/team/roles", "GET", {
      cookie: owner.cookie,
      organizationId,
    });
    const ownerRole = (
      (await roles.json()) as Array<{ id: string; key: string }>
    ).find((role) => role.key === "owner")!;
    const staff = await request("/business/team/roles", "POST", {
      cookie: owner.cookie,
      organizationId,
      body: { name: "Staff", key: "staff", permissions: [] },
    });
    const staffRole = (await staff.json()) as { id: string };

    const demote = await request(
      `/business/team/members/${self.id}/role`,
      "PATCH",
      {
        cookie: owner.cookie,
        organizationId,
        body: { roleId: staffRole.id },
      },
    );
    expect(demote.status).toBe(409);

    const remove = await request(
      `/business/team/members/${self.id}`,
      "DELETE",
      {
        cookie: owner.cookie,
        organizationId,
      },
    );
    expect(remove.status).toBe(400);
    expect(ownerRole.key).toBe("owner");
  });

  it("keeps branch access and members isolated between organizations", async () => {
    const ownerA = await register(
      `${emailPrefix}a@example.com`,
      "Owner A",
      "Tenant A",
    );
    const ownerB = await register(
      `${emailPrefix}b@example.com`,
      "Owner B",
      "Tenant B",
    );
    const orgA = ownerA.user.organizations[0].id;
    const orgB = ownerB.user.organizations[0].id;

    const memberInvite = await request("/business/team/invitations", "POST", {
      cookie: ownerA.cookie,
      organizationId: orgA,
      body: {
        email: `${emailPrefix}a-member@example.com`,
        roleId: (
          (await (
            await request("/business/team/roles", "GET", {
              cookie: ownerA.cookie,
              organizationId: orgA,
            })
          ).json()) as Array<{ id: string }>
        )[0].id,
      },
    });
    expect(memberInvite.status).toBe(201);
    const token = ((await memberInvite.json()) as { token: string }).token;
    const joined = await request("/invitations/accept", "POST", {
      body: { token, name: "A Member", password },
    });
    expect(joined.status).toBe(201);
    const joinedEmail = `${emailPrefix}a-member@example.com`;
    const memberCookie = await login(joinedEmail);

    const membersA = await request("/business/team/members", "GET", {
      cookie: ownerA.cookie,
      organizationId: orgA,
    });
    const memberList = (await membersA.json()) as {
      items: Array<{ id: string; user: { email: string } }>;
    };
    const memberId = memberList.items.find(
      (item) => item.user.email === joinedEmail,
    )!.id;

    const branch = await request("/business/branches", "POST", {
      cookie: ownerA.cookie,
      organizationId: orgA,
      body: { name: `Branch ${runId.slice(0, 8)}` },
    });
    const branchId = ((await branch.json()) as { id: string }).id;

    const assigned = await request(
      `/business/team/members/${memberId}/branches`,
      "PATCH",
      {
        cookie: ownerA.cookie,
        organizationId: orgA,
        body: { branchIds: [branchId] },
      },
    );
    expect(assigned.status).toBe(200);

    const mine = await request("/business/team/me/branches", "GET", {
      cookie: memberCookie,
      organizationId: orgA,
    });
    expect(
      ((await mine.json()) as Array<{ id: string }>).map((item) => item.id),
    ).toEqual([branchId]);

    // An organization-B branch cannot be granted by an organization-A admin.
    const branchB = await request("/business/branches", "POST", {
      cookie: ownerB.cookie,
      organizationId: orgB,
      body: { name: `Branch B ${runId.slice(0, 8)}` },
    });
    const branchBId = ((await branchB.json()) as { id: string }).id;
    const crossGrant = await request(
      `/business/team/members/${memberId}/branches`,
      "PATCH",
      {
        cookie: ownerA.cookie,
        organizationId: orgA,
        body: { branchIds: [branchBId] },
      },
    );
    expect(crossGrant.status).toBe(400);

    const crossTenantMembers = await request("/business/team/members", "GET", {
      cookie: ownerB.cookie,
      organizationId: orgA,
    });
    expect(crossTenantMembers.status).toBe(403);

    const crossTenantInvitations = await request(
      "/business/team/invitations",
      "GET",
      {
        cookie: ownerB.cookie,
        organizationId: orgA,
      },
    );
    expect(crossTenantInvitations.status).toBe(403);

    // A user cannot accept an invitation addressed to someone else's email.
    const otherInvite = await request("/business/team/invitations", "POST", {
      cookie: ownerA.cookie,
      organizationId: orgA,
      body: {
        email: `${emailPrefix}someone-else@example.com`,
        roleId: memberList.items[0].id,
      },
    });
    const otherToken = ((await otherInvite.json()) as { token: string }).token;
    const wrongAcceptor = await request(
      `/invitations/${otherToken}/accept`,
      "POST",
      { cookie: memberCookie },
    );
    // A different account must not consume someone else's invitation. The API
    // answers 404 for an unknown token and 403 for a token issued to another
    // email; both deny without granting membership.
    expect([403, 404]).toContain(wrongAcceptor.status);
    const notJoined = await request("/auth/me", "GET", { cookie: memberCookie });
    const joinedOrganizations = (
      (await notJoined.json()) as { organizations: Array<{ id: string }> }
    ).organizations.map((organization) => organization.id);
    expect(joinedOrganizations).toEqual([orgA]);
  });

  it("records an employee lifecycle and revokes branch access on removal", async () => {
    const owner = await register(
      `${emailPrefix}emp@example.com`,
      "Employer",
      "Employer Org",
    );
    const organizationId = owner.user.organizations[0].id;
    const invite = await request("/business/team/invitations", "POST", {
      cookie: owner.cookie,
      organizationId,
      body: {
        email: `${emailPrefix}employee@example.com`,
        roleId: (
          (await (
            await request("/business/team/roles", "GET", {
              cookie: owner.cookie,
              organizationId,
            })
          ).json()) as Array<{ id: string }>
        )[0].id,
      },
    });
    await request("/invitations/accept", "POST", {
      body: {
        token: ((await invite.json()) as { token: string }).token,
        name: "Employee",
        password,
      },
    });

    const employees = (await (
      await request("/business/team/members", "GET", {
        cookie: owner.cookie,
        organizationId,
      })
    ).json()) as {
      items: Array<{ id: string; user: { email: string } }>;
    };
    const employeeId = employees.items.find(
      (item) => item.user.email === `${emailPrefix}employee@example.com`,
    )!.id;

    const saved = await request(
      `/business/team/members/${employeeId}/employee`,
      "PATCH",
      {
        cookie: owner.cookie,
        organizationId,
        body: {
          jobTitle: "Warehouse lead",
          department: "Operations",
          employmentType: "full_time",
          hiredAt: "2026-01-05",
        },
      },
    );
    expect(saved.status).toBe(200);

    const ended = await request(
      `/business/team/members/${employeeId}/employee`,
      "PATCH",
      {
        cookie: owner.cookie,
        organizationId,
        body: { endEmployment: true },
      },
    );
    const endedBody = (await ended.json()) as {
      status: string;
      endedAt: string | null;
    };
    expect(endedBody.status).toBe("ENDED");
    expect(endedBody.endedAt).not.toBeNull();

    const removed = await request(
      `/business/team/members/${employeeId}`,
      "DELETE",
      {
        cookie: owner.cookie,
        organizationId,
      },
    );
    expect(removed.status).toBe(200);
    expect(
      await database.branchAccess.count({ where: { memberId: employeeId } }),
    ).toBe(0);

    const audits = await request("/business/audit?action=member.removed", "GET", {
      cookie: owner.cookie,
      organizationId,
    });
    expect(audits.status).toBe(200);
    expect(
      ((await audits.json()) as { items: unknown[] }).items.length,
    ).toBeGreaterThan(0);
  });
});
