import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma, database } from "@ubos/database";
import { createHash, randomBytes } from "node:crypto";
import type {
  AuthenticatedUser,
  OrganizationContext,
} from "../common/http-context";
import { runTransaction } from "../common/transactions";
import { hashPassword } from "../auth/password";
import { OWNER_PERMISSIONS } from "../common/owner-permissions";
import {
  CreateInvitationDto,
  CreateRoleDto,
  UpdateMemberBranchesDto,
  UpdateMemberRoleDto,
  UpdateRoleDto,
  UpsertEmployeeProfileDto,
} from "./team.dto";

type Tx = Prisma.TransactionClient;

const DEFAULT_EXPIRY_DAYS = 7;
const MEMBER_PAGE_SIZE = 100;

/**
 * Organization administration: roles, members, invitations, branch access and
 * employee profiles. Every query is scoped by the organization resolved from the
 * authenticated membership; no identifier from the request can widen that scope.
 */
@Injectable()
export class TeamService {
  // ---------------------------------------------------------------------------
  // Members
  // ---------------------------------------------------------------------------

  async listMembers(org: OrganizationContext) {
    const members = await database.organizationMember.findMany({
      where: { organizationId: org.id },
      orderBy: { createdAt: "asc" },
      take: MEMBER_PAGE_SIZE,
      select: {
        id: true,
        createdAt: true,
        user: { select: { id: true, name: true, email: true } },
        role: { select: { id: true, key: true, name: true } },
        branchAccess: { select: { branchId: true } },
        employeeProfile: {
          select: {
            id: true,
            employeeNumber: true,
            jobTitle: true,
            department: true,
            employmentType: true,
            status: true,
            hiredAt: true,
            endedAt: true,
          },
        },
      },
    });
    const total = await database.organizationMember.count({
      where: { organizationId: org.id },
    });
    return {
      items: members.map((member) => ({
        id: member.id,
        createdAt: member.createdAt,
        user: member.user,
        role: member.role,
        branchIds: member.branchAccess.map(({ branchId }) => branchId),
        employee: member.employeeProfile,
        isCurrentUser: member.user.id === org.memberId ? true : false,
      })),
      total,
      truncated: total > members.length,
    };
  }

  async updateMemberRole(
    memberId: string,
    input: UpdateMemberRoleDto,
    org: OrganizationContext,
    actorId: string,
  ) {
    return runTransaction(async (tx) => {
      // Lock the owning organization row so two concurrent demotions cannot both
      // pass the "last owner" check and leave the organization ownerless.
      await tx.$queryRaw`SELECT "id" FROM "Organization" WHERE "id" = ${org.id} FOR UPDATE`;
      const member = await this.requireMember(tx, org.id, memberId);
      const role = await tx.role.findFirst({
        where: { id: input.roleId, organizationId: org.id },
        select: { id: true, key: true },
      });
      if (!role) throw new NotFoundException("Role was not found.");
      await this.assertNotLastOwner(tx, org.id, member, role.key);
      const updated = await tx.organizationMember.update({
        where: { id: memberId },
        data: { roleId: role.id },
        select: {
          id: true,
          role: { select: { id: true, key: true, name: true } },
        },
      });
      await this.audit(
        tx,
        org.id,
        actorId,
        "member.role_changed",
        "member",
        memberId,
        {
          previousRole: member.role.key,
          role: role.key,
        },
      );
      return updated;
    });
  }

  async removeMember(
    memberId: string,
    org: OrganizationContext,
    actorId: string,
  ) {
    return runTransaction(async (tx) => {
      const member = await this.requireMember(tx, org.id, memberId);
      if (member.id === org.memberId) {
        throw new BadRequestException("You cannot remove your own membership.");
      }
      await this.assertNotLastOwner(tx, org.id, member, null);
      await tx.branchAccess.deleteMany({
        where: { organizationId: org.id, memberId },
      });
      await tx.organizationMember.delete({ where: { id: memberId } });
      await this.audit(
        tx,
        org.id,
        actorId,
        "member.removed",
        "member",
        memberId,
        {
          email: member.user.email,
        },
      );
      return { removed: true };
    });
  }

  // ---------------------------------------------------------------------------
  // Invitations
  // ---------------------------------------------------------------------------

  async listInvitations(org: OrganizationContext) {
    const rows = await database.invitation.findMany({
      where: { organizationId: org.id },
      orderBy: { createdAt: "desc" },
      take: MEMBER_PAGE_SIZE,
      select: {
        id: true,
        email: true,
        status: true,
        expiresAt: true,
        acceptedAt: true,
        createdAt: true,
        role: { select: { id: true, key: true, name: true } },
        invitedBy: { select: { id: true, name: true } },
      },
    });
    const now = new Date();
    return rows.map((invitation) => ({
      ...invitation,
      expired: invitation.status === "PENDING" && invitation.expiresAt <= now,
    }));
  }

  /**
   * Creates a pending invitation and returns its one-time token. The token is
   * only stored as a SHA-256 digest; the caller must deliver the link itself.
   */
  async createInvitation(
    input: CreateInvitationDto,
    org: OrganizationContext,
    actorId: string,
  ) {
    const email = input.email.trim().toLowerCase();
    return runTransaction(async (tx) => {
      const role = await tx.role.findFirst({
        where: { id: input.roleId, organizationId: org.id },
        select: { id: true, key: true },
      });
      if (!role) throw new NotFoundException("Role was not found.");

      const existingMember = await tx.organizationMember.findFirst({
        where: { organizationId: org.id, user: { email } },
        select: { id: true },
      });
      if (existingMember) {
        throw new ConflictException(
          "This person is already a member of the organization.",
        );
      }

      const token = randomBytes(24).toString("base64url");
      const tokenHash = createHash("sha256").update(token).digest("hex");
      const expiresAt = new Date(
        Date.now() +
          Number(process.env.INVITATION_TTL_DAYS ?? DEFAULT_EXPIRY_DAYS) *
            86_400_000,
      );

      // Re-inviting supersedes an earlier pending invitation for the same email.
      await tx.invitation.updateMany({
        where: { organizationId: org.id, email, status: "PENDING" },
        data: { status: "REVOKED" },
      });
      const invitation = await tx.invitation.create({
        data: {
          organizationId: org.id,
          email,
          roleId: role.id,
          tokenHash,
          invitedById: actorId,
          expiresAt,
        },
        select: { id: true, email: true, status: true, expiresAt: true },
      });
      await this.audit(
        tx,
        org.id,
        actorId,
        "invitation.created",
        "invitation",
        invitation.id,
        {
          role: role.key,
        },
      );
      return { ...invitation, token };
    });
  }

  async revokeInvitation(
    invitationId: string,
    org: OrganizationContext,
    actorId: string,
  ) {
    return runTransaction(async (tx) => {
      const invitation = await tx.invitation.findFirst({
        where: { id: invitationId, organizationId: org.id },
        select: { id: true, status: true },
      });
      if (!invitation) throw new NotFoundException("Invitation was not found.");
      if (invitation.status !== "PENDING") {
        throw new ConflictException("Only pending invitations can be revoked.");
      }
      await tx.invitation.update({
        where: { id: invitationId },
        data: { status: "REVOKED" },
      });
      await this.audit(
        tx,
        org.id,
        actorId,
        "invitation.revoked",
        "invitation",
        invitationId,
      );
      return { revoked: true };
    });
  }

  /**
   * Accepts an invitation for the authenticated user. The invited email must
   * match the session's account so a leaked token cannot add a different person.
   */
  async acceptInvitation(input: { token: string }, user: AuthenticatedUser) {
    const tokenHash = createHash("sha256").update(input.token).digest("hex");
    return runTransaction(async (tx) => {
      const invitation = await tx.invitation.findUnique({
        where: { tokenHash },
        select: {
          id: true,
          organizationId: true,
          email: true,
          roleId: true,
          status: true,
          expiresAt: true,
        },
      });
      if (!invitation) throw new NotFoundException("Invitation was not found.");
      if (invitation.status !== "PENDING") {
        throw new ConflictException("This invitation is no longer valid.");
      }
      if (invitation.expiresAt <= new Date()) {
        await tx.invitation.update({
          where: { id: invitation.id },
          data: { status: "EXPIRED" },
        });
        throw new ConflictException("This invitation has expired.");
      }
      if (invitation.email !== user.email.trim().toLowerCase()) {
        throw new ForbiddenException(
          "This invitation was issued to a different email address.",
        );
      }
      const existing = await tx.organizationMember.findUnique({
        where: {
          organizationId_userId: {
            organizationId: invitation.organizationId,
            userId: user.id,
          },
        },
        select: { id: true },
      });
      if (existing)
        throw new ConflictException(
          "You are already a member of this organization.",
        );

      const member = await tx.organizationMember.create({
        data: {
          organizationId: invitation.organizationId,
          userId: user.id,
          roleId: invitation.roleId,
        },
        select: {
          id: true,
          organization: { select: { id: true, name: true } },
        },
      });
      await tx.invitation.update({
        where: { id: invitation.id },
        data: {
          status: "ACCEPTED",
          acceptedAt: new Date(),
          acceptedById: user.id,
        },
      });
      await this.audit(
        tx,
        invitation.organizationId,
        user.id,
        "invitation.accepted",
        "member",
        member.id,
        { invitationId: invitation.id },
      );
      return { organization: member.organization, memberId: member.id };
    });
  }

  /**
   * Registers a brand-new account and accepts the invitation in one transaction,
   * for invitees who do not have a UBOS account yet.
   */
  async acceptInvitationByRegistration(input: {
    token: string;
    name?: string;
    password?: string;
    email?: string;
  }) {
    const tokenHash = createHash("sha256").update(input.token).digest("hex");
    if (!input.name || !input.password) {
      throw new BadRequestException(
        "Provide a name and password to create the invited account.",
      );
    }
    const passwordHash = await hashPassword(input.password);
    return runTransaction(async (tx) => {
      const invitation = await tx.invitation.findUnique({
        where: { tokenHash },
        select: {
          id: true,
          organizationId: true,
          email: true,
          roleId: true,
          status: true,
          expiresAt: true,
        },
      });
      if (!invitation) throw new NotFoundException("Invitation was not found.");
      if (
        invitation.status !== "PENDING" ||
        invitation.expiresAt <= new Date()
      ) {
        throw new ConflictException("This invitation is no longer valid.");
      }
      const created = await tx.user.create({
        data: {
          email: invitation.email,
          name: input.name!.trim(),
          passwordHash,
        },
        select: { id: true, email: true, name: true },
      });
      const member = await tx.organizationMember.create({
        data: {
          organizationId: invitation.organizationId,
          userId: created.id,
          roleId: invitation.roleId,
        },
        select: {
          id: true,
          organization: { select: { id: true, name: true } },
          role: { select: { key: true } },
        },
      });
      await tx.invitation.update({
        where: { id: invitation.id },
        data: {
          status: "ACCEPTED",
          acceptedAt: new Date(),
          acceptedById: created.id,
        },
      });
      await this.audit(
        tx,
        invitation.organizationId,
        created.id,
        "invitation.accepted",
        "member",
        member.id,
        {
          invitationId: invitation.id,
          via: "registration",
        },
      );
      return {
        user: created,
        organization: { ...member.organization, role: member.role.key },
      };
    });
  }

  // ---------------------------------------------------------------------------
  // Roles
  // ---------------------------------------------------------------------------

  async listRoles(org: OrganizationContext) {
    const roles = await database.role.findMany({
      where: { organizationId: org.id },
      orderBy: { name: "asc" },
      select: {
        id: true,
        key: true,
        name: true,
        createdAt: true,
        permissions: { select: { permission: { select: { key: true } } } },
        _count: { select: { members: true } },
      },
    });
    return roles.map((role) => ({
      id: role.id,
      key: role.key,
      name: role.name,
      createdAt: role.createdAt,
      memberCount: role._count.members,
      permissions: role.permissions.map(({ permission }) => permission.key),
    }));
  }

  async createRole(
    input: CreateRoleDto,
    org: OrganizationContext,
    actorId: string,
  ) {
    const permissions = [...new Set(input.permissions)];
    const known = await database.permission.findMany({
      where: { key: { in: permissions } },
      select: { id: true, key: true },
    });
    if (known.length !== permissions.length) {
      throw new BadRequestException("One or more permission keys are unknown.");
    }
    return runTransaction(async (tx) => {
      const existing = await tx.role.findFirst({
        where: { organizationId: org.id, key: input.key },
        select: { id: true },
      });
      if (existing)
        throw new ConflictException("A role with this key already exists.");
      const role = await tx.role.create({
        data: {
          organizationId: org.id,
          key: input.key,
          name: input.name.trim(),
          permissions: {
            create: known.map(({ id }) => ({ permissionId: id })),
          },
        },
        select: { id: true, key: true, name: true },
      });
      await this.audit(tx, org.id, actorId, "role.created", "role", role.id, {
        key: role.key,
      });
      return { ...role, permissions };
    });
  }

  async updateRole(
    roleId: string,
    input: UpdateRoleDto,
    org: OrganizationContext,
    actorId: string,
  ) {
    return runTransaction(async (tx) => {
      const role = await tx.role.findFirst({
        where: { id: roleId, organizationId: org.id },
        select: { id: true, key: true },
      });
      if (!role) throw new NotFoundException("Role was not found.");
      if (role.key === "owner" && input.permissions) {
        throw new ForbiddenException(
          "The owner role permissions are managed by the system.",
        );
      }
      let permissionRecords: Array<{ id: string }> | undefined;
      if (input.permissions) {
        const unique = [...new Set(input.permissions)];
        const known = await tx.permission.findMany({
          where: { key: { in: unique } },
          select: { id: true, key: true },
        });
        if (known.length !== unique.length) {
          throw new BadRequestException(
            "One or more permission keys are unknown.",
          );
        }
        permissionRecords = known.map(({ id }) => ({ id }));
      }
      const updated = await tx.role.update({
        where: { id: roleId },
        data: { name: input.name?.trim() },
        select: { id: true, key: true, name: true },
      });
      if (permissionRecords) {
        await tx.rolePermission.deleteMany({ where: { roleId } });
        await tx.rolePermission.createMany({
          data: permissionRecords.map(({ id }) => ({
            roleId,
            permissionId: id,
          })),
        });
      }
      await this.audit(tx, org.id, actorId, "role.updated", "role", roleId, {
        nameChanged: input.name !== undefined,
        permissionsChanged: Boolean(input.permissions),
      });
      return updated;
    });
  }

  async listPermissions() {
    return database.permission.findMany({
      orderBy: { key: "asc" },
      select: { key: true, description: true },
    });
  }

  // ---------------------------------------------------------------------------
  // Branch access
  // ---------------------------------------------------------------------------

  async setMemberBranches(
    memberId: string,
    input: UpdateMemberBranchesDto,
    org: OrganizationContext,
    actorId: string,
  ) {
    const branchIds = [...new Set(input.branchIds)];
    return runTransaction(async (tx) => {
      const member = await this.requireMember(tx, org.id, memberId);
      if (member.id === org.memberId) {
        throw new BadRequestException(
          "You cannot change your own branch access.",
        );
      }
      if (branchIds.length > 0) {
        const branches = await tx.branch.findMany({
          where: { organizationId: org.id, id: { in: branchIds } },
          select: { id: true },
        });
        if (branches.length !== branchIds.length) {
          throw new BadRequestException(
            "One or more branches do not belong to this organization.",
          );
        }
      }
      await tx.branchAccess.deleteMany({
        where: { organizationId: org.id, memberId },
      });
      if (branchIds.length > 0) {
        await tx.branchAccess.createMany({
          data: branchIds.map((branchId) => ({
            organizationId: org.id,
            memberId,
            branchId,
          })),
        });
      }
      await this.audit(
        tx,
        org.id,
        actorId,
        "member.branch_access_updated",
        "member",
        memberId,
        {
          branchCount: branchIds.length,
        },
      );
      return { memberId, branchIds };
    });
  }

  async listMyBranches(org: OrganizationContext) {
    const access = await database.branchAccess.findMany({
      where: { organizationId: org.id, memberId: org.memberId },
      select: { branch: { select: { id: true, name: true } } },
    });
    return access.map(({ branch }) => branch);
  }

  // ---------------------------------------------------------------------------
  // Employee profile
  // ---------------------------------------------------------------------------

  async upsertEmployee(
    memberId: string,
    input: UpsertEmployeeProfileDto,
    org: OrganizationContext,
    actorId: string,
  ) {
    const parseDate = (value: string | null | undefined, field: string) => {
      if (value === undefined || value === null || value === "")
        return value === null ? null : undefined;
      const parsed = new Date(value);
      if (Number.isNaN(parsed.getTime()))
        throw new BadRequestException(`${field} must be a valid date.`);
      return parsed;
    };
    return runTransaction(async (tx) => {
      const member = await this.requireMember(tx, org.id, memberId);
      const data: Prisma.EmployeeProfileUncheckedUpdateInput &
        Prisma.EmployeeProfileUncheckedCreateInput = {
        organizationId: org.id,
        memberId: member.id,
      };
      if (input.employeeNumber !== undefined)
        data.employeeNumber = input.employeeNumber?.trim() || null;
      if (input.jobTitle !== undefined)
        data.jobTitle = input.jobTitle?.trim() || null;
      if (input.department !== undefined)
        data.department = input.department?.trim() || null;
      if (input.employmentType !== undefined)
        data.employmentType = input.employmentType;
      if (input.hiredAt !== undefined)
        data.hiredAt = parseDate(input.hiredAt, "hiredAt");
      if (input.status !== undefined) data.status = input.status;
      if (input.endedAt !== undefined)
        data.endedAt = parseDate(input.endedAt, "endedAt");
      if (input.endEmployment) {
        data.status = "ENDED";
        data.endedAt = new Date();
      }
      const profile = await tx.employeeProfile.upsert({
        where: { memberId: member.id },
        create: data,
        update: data,
      });
      await this.audit(
        tx,
        org.id,
        actorId,
        "employee.updated",
        "member",
        member.id,
        {
          status: profile.status,
          ended: Boolean(input.endEmployment),
        },
      );
      return profile;
    });
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private async requireMember(
    tx: Tx,
    organizationId: string,
    memberId: string,
  ) {
    const member = await tx.organizationMember.findFirst({
      where: { id: memberId, organizationId },
      select: {
        id: true,
        role: { select: { id: true, key: true } },
        user: { select: { email: true } },
      },
    });
    if (!member) throw new NotFoundException("Member was not found.");
    return member;
  }

  /** The organization must always retain at least one owner. */
  private async assertNotLastOwner(
    tx: Tx,
    organizationId: string,
    member: { id: string; role: { key: string } },
    nextRoleKey: string | null,
  ) {
    if (member.role.key !== "owner" || nextRoleKey === "owner") return;
    const owners = await tx.organizationMember.count({
      where: { organizationId, role: { key: "owner" } },
    });
    if (owners <= 1) {
      throw new ConflictException(
        "The organization must keep at least one owner.",
      );
    }
  }

  private async audit(
    tx: Tx,
    organizationId: string,
    actorId: string | null,
    action: string,
    entityType: string,
    entityId: string,
    metadata?: Prisma.InputJsonValue,
  ) {
    await tx.auditLog.create({
      data: { organizationId, actorId, action, entityType, entityId, metadata },
    });
  }
}

export const SYSTEM_PERMISSION_KEYS = OWNER_PERMISSIONS.map(([key]) => key);
