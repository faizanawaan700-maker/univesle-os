import { ForbiddenException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { ExecutionContext } from "@nestjs/common";
import { PermissionsGuard } from "./permissions.guard";

function createContext(request: {
  user?: { id: string; email: string; name: string };
  organization?: { permissions: string[] };
}) {
  return {
    getHandler: () => ({}),
    getClass: () => ({}),
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

describe("PermissionsGuard", () => {
  function createGuard(requiredPermissions: string[]) {
    const reflector = {
      getAllAndOverride: jest.fn().mockReturnValue(requiredPermissions),
    } as unknown as Reflector;
    return new PermissionsGuard(reflector);
  }

  it("allows a role with the required permission", () => {
    const guard = createGuard(["organization.read"]);
    const context = createContext({
      user: { id: "user-1", email: "one@example.com", name: "One" },
      organization: { permissions: ["organization.read", "audit.read"] },
    });

    expect(guard.canActivate(context)).toBe(true);
  });

  it("denies a member whose role lacks the required permission", () => {
    const guard = createGuard(["organization.read"]);
    const context = createContext({
      user: { id: "user-2", email: "two@example.com", name: "Two" },
      organization: { permissions: [] },
    });

    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });

  it("does not require permission metadata on unprotected routes", () => {
    const guard = createGuard([]);
    expect(guard.canActivate(createContext({}))).toBe(true);
  });
});
