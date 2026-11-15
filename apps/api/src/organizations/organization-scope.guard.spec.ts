import { ForbiddenException } from "@nestjs/common";
import type { ExecutionContext } from "@nestjs/common";
import { database } from "@ubos/database";
import { OrganizationScopeGuard } from "./organization-scope.guard";

jest.mock("@ubos/database", () => ({
  database: {
    organizationMember: { findUnique: jest.fn() },
  },
}));

function createContext(request: {
  user?: { id: string; email: string; name: string };
  header: (name: string) => string | undefined;
}) {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

describe("OrganizationScopeGuard", () => {
  const findUnique = jest.mocked(database.organizationMember.findUnique);
  const guard = new OrganizationScopeGuard();

  beforeEach(() => jest.clearAllMocks());

  it("rejects an organization that is not one of the user's memberships", async () => {
    findUnique.mockResolvedValue(null);
    const context = createContext({
      user: { id: "user-1", email: "one@example.com", name: "One" },
      header: () => "org-owned-by-someone-else",
    });

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          organizationId_userId: {
            organizationId: "org-owned-by-someone-else",
            userId: "user-1",
          },
        },
      }),
    );
  });

  it("attaches the member's organization and permission context", async () => {
    findUnique.mockResolvedValue({
      id: "member-1",
      organization: { id: "org-1", name: "Acme" },
      role: {
        key: "owner",
        permissions: [{ permission: { key: "organization.read" } }],
      },
    } as never);
    const request = {
      user: { id: "user-1", email: "one@example.com", name: "One" },
      header: () => "org-1",
    };

    await expect(guard.canActivate(createContext(request))).resolves.toBe(true);
    expect(request).toHaveProperty("organization", {
      id: "org-1",
      name: "Acme",
      memberId: "member-1",
      roleKey: "owner",
      permissions: ["organization.read"],
    });
  });
});
