import type { Request } from "express";

export interface AuthenticatedUser {
  id: string;
  email: string;
  name: string;
}

export interface OrganizationContext {
  id: string;
  name: string;
  memberId: string;
  roleKey: string;
  permissions: string[];
}

export interface ApiRequest extends Request {
  user?: AuthenticatedUser;
  organization?: OrganizationContext;
}
