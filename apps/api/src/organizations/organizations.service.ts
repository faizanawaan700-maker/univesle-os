import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { database } from "@ubos/database";
import type { AuthenticatedUser, OrganizationContext } from "../common/http-context";
import { OWNER_PERMISSIONS } from "../common/owner-permissions";
import { MAX_LIST_ROWS } from "../common/query-limits";
import { runTransaction } from "../common/transactions";
import { CreateOrganizationDto } from "./organizations.dto";

@Injectable()
export class OrganizationsService {
  async listForUser(userId: string) {
    const memberships = await database.organizationMember.findMany({
      where: { userId },
      select: {
        organization: { select: { id: true, name: true, createdAt: true } },
        role: {
          select: {
            key: true,
            name: true,
          },
        },
      },
      orderBy: { createdAt: "asc" },
      take: MAX_LIST_ROWS,
    });

    return memberships.map(({ organization, role }) => ({
      ...organization,
      role: role.key,
      roleName: role.name,
    }));
  }

  async create(input: CreateOrganizationDto, user: AuthenticatedUser) {
    const name = input.name.trim();
    if (!name) throw new BadRequestException("Organization name cannot be blank.");
    return runTransaction(async (tx) => {
      const organization = await tx.organization.create({ data: { name } });
      const role = await tx.role.create({
        data: { organizationId: organization.id, name: "Owner", key: "owner" },
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
        data: { organizationId: organization.id, userId: user.id, roleId: role.id },
      });
      await tx.auditLog.create({
        data: {
          organizationId: organization.id,
          actorId: user.id,
          action: "organization.created",
          entityType: "organization",
          entityId: organization.id,
          metadata: { source: "authenticated_user" },
        },
      });

      return {
        id: organization.id,
        name: organization.name,
        role: role.key,
        createdAt: organization.createdAt,
      };
    });
  }

  async getCurrentOrganization(context: OrganizationContext) {
    const organization = await database.organization.findUnique({
      where: { id: context.id },
      select: { id: true, name: true, createdAt: true },
    });
    if (!organization) {
      throw new NotFoundException("Organization was not found.");
    }
    return { ...organization, role: context.roleKey, permissions: context.permissions };
  }
}
