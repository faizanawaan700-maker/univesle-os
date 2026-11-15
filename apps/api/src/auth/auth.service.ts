import {
  BadRequestException,
  ConflictException,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { database } from "@ubos/database";
import { createHash, randomBytes } from "node:crypto";
import { OWNER_PERMISSIONS } from "../common/owner-permissions";
import { isUniqueConstraintError } from "../common/prisma-errors";
import { runTransaction } from "../common/transactions";
import { LoginDto, RegisterDto } from "./auth.dto";
import { hashPassword, verifyPassword } from "./password";

export interface AuthenticatedResponse {
  id: string;
  email: string;
  name: string;
  organizations: Array<{ id: string; name: string; role: string; permissions?: string[] }>;
}

export interface CreatedSession {
  token: string;
  expiresAt: Date;
  user: AuthenticatedResponse;
}

@Injectable()
export class AuthService {
  async register(input: RegisterDto): Promise<CreatedSession> {
    const email = input.email.trim().toLowerCase();
    const name = input.name.trim();
    const organizationName = input.organizationName.trim();
    if (!name || !organizationName) {
      throw new BadRequestException("Name and organization name cannot be blank.");
    }
    const passwordHash = await hashPassword(input.password);
    const { token, tokenHash, expiresAt } = createSessionCredentials();

    try {
      const user = await runTransaction(async (tx) => {
        const createdUser = await tx.user.create({
          data: { email, name, passwordHash },
        });
        const organization = await tx.organization.create({
          data: { name: organizationName },
        });
        const role = await tx.role.create({
          data: {
            organizationId: organization.id,
            name: "Owner",
            key: "owner",
          },
        });

        const permissions = await Promise.all(
          OWNER_PERMISSIONS.map(([key, description]) =>
            tx.permission.upsert({
              where: { key },
              update: {},
              create: { key, description },
              select: { id: true },
            }),
          ),
        );
        await tx.rolePermission.createMany({
          data: permissions.map(({ id }) => ({ roleId: role.id, permissionId: id })),
        });
        await tx.organizationMember.create({
          data: { organizationId: organization.id, userId: createdUser.id, roleId: role.id },
        });
        await tx.session.create({
          data: { tokenHash, userId: createdUser.id, expiresAt },
        });
        await tx.auditLog.create({
          data: {
            organizationId: organization.id,
            actorId: createdUser.id,
            action: "organization.created",
            entityType: "organization",
            entityId: organization.id,
            metadata: { source: "registration" },
          },
        });

        return { createdUser, organization, role };
      });

      return {
        token,
        expiresAt,
        user: {
          id: user.createdUser.id,
          email: user.createdUser.email,
          name: user.createdUser.name,
          organizations: [
            {
              id: user.organization.id,
              name: user.organization.name,
              role: user.role.key,
              permissions: OWNER_PERMISSIONS.map(([key]) => key),
            },
          ],
        },
      };
    } catch (error) {
      if (isUniqueConstraintError(error, ["email"])) {
        throw new ConflictException("An account with this email already exists.");
      }
      throw error;
    }
  }

  async login(input: LoginDto): Promise<CreatedSession> {
    const email = input.email.trim().toLowerCase();
    const user = await database.user.findUnique({
      where: { email },
      select: { id: true, email: true, name: true, passwordHash: true },
    });
    const valid = user
      ? await verifyPassword(input.password, user.passwordHash)
      : await verifyPassword(
          input.password,
          "scrypt$16384$8$1$00000000000000000000000000000000$00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000",
        );

    if (!user || !valid) {
      throw new UnauthorizedException("Email or password is incorrect.");
    }

    const { token, tokenHash, expiresAt } = createSessionCredentials();
    const now = new Date();
    const memberships = await runTransaction(async (tx) => {
      await tx.session.deleteMany({
        where: { userId: user.id, expiresAt: { lte: now } },
      });
      const currentMemberships = await tx.organizationMember.findMany({
        where: { userId: user.id },
        select: {
          organization: { select: { id: true, name: true } },
          role: {
            select: {
              key: true,
              permissions: {
                select: {
                  permission: { select: { key: true } },
                },
              },
            },
          },
        },
        orderBy: { createdAt: "asc" },
      });

      const session = await tx.session.create({
        data: { tokenHash, userId: user.id, expiresAt },
        select: { id: true },
      });
      if (currentMemberships.length > 0) {
        await tx.auditLog.createMany({
          data: currentMemberships.map(({ organization }) => ({
            organizationId: organization.id,
            actorId: user.id,
            action: "auth.session_created",
            entityType: "session",
            entityId: session.id,
          })),
        });
      }
      return currentMemberships;
    });

    return {
      token,
      expiresAt,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        organizations: memberships.map(({ organization, role }) => ({
          ...organization,
          role: role.key,
          permissions: role.permissions.map(({ permission }) => permission.key),
        })),
      },
    };
  }

  async logout(token: string): Promise<void> {
    const tokenHash = createHash("sha256").update(token).digest("hex");
    await runTransaction(async (tx) => {
      const session = await tx.session.findUnique({
        where: { tokenHash },
        select: {
          id: true,
          userId: true,
          user: {
            select: { memberships: { select: { organizationId: true } } },
          },
        },
      });
      if (!session) return;

      const deleted = await tx.session.deleteMany({ where: { id: session.id } });
      if (deleted.count === 0 || session.user.memberships.length === 0) return;

      await tx.auditLog.createMany({
        data: session.user.memberships.map(({ organizationId }) => ({
          organizationId,
          actorId: session.userId,
          action: "auth.session_revoked",
          entityType: "session",
          entityId: session.id,
        })),
      });
    });
  }

  async getProfile(userId: string): Promise<AuthenticatedResponse> {
    const user = await database.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        name: true,
        memberships: {
          select: {
            organization: { select: { id: true, name: true } },
            role: {
              select: {
                key: true,
                permissions: {
                  select: {
                    permission: { select: { key: true } },
                  },
                },
              },
            },
          },
          orderBy: { createdAt: "asc" },
        },
      },
    });
    if (!user) {
      throw new UnauthorizedException("Authentication is required.");
    }

    return {
      id: user.id,
      email: user.email,
      name: user.name,
      organizations: user.memberships.map(({ organization, role }) => ({
        ...organization,
        role: role.key,
        permissions: role.permissions.map(({ permission }) => permission.key),
      })),
    };
  }
}

export function createSessionCredentials(): {
  token: string;
  tokenHash: string;
  expiresAt: Date;
} {
  const token = randomBytes(32).toString("base64url");
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const ttlDays = Number(process.env.SESSION_TTL_DAYS ?? 7);
  if (!Number.isInteger(ttlDays) || ttlDays < 1 || ttlDays > 30) {
    throw new Error("SESSION_TTL_DAYS must be an integer between 1 and 30.");
  }
  const expiresAt = new Date(Date.now() + ttlDays * 24 * 60 * 60 * 1000);
  return { token, tokenHash, expiresAt };
}

