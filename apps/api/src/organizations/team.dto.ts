import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  Length,
  MaxLength,
} from "class-validator";

export const EMPLOYMENT_TYPES = ["full_time", "part_time", "contract", "other"] as const;
export const EMPLOYEE_STATUSES = ["ACTIVE", "SUSPENDED", "ENDED"] as const;

export class CreateInvitationDto {
  @IsEmail()
  @MaxLength(320)
  email!: string;

  @IsString()
  @Length(1, 64)
  roleId!: string;
}

export class AcceptInvitationDto {
  @IsString()
  @Length(16, 200)
  token!: string;

  /** Required only when the invited email has no account yet. */
  @IsOptional()
  @IsString()
  @Length(1, 120)
  name?: string;

  @IsOptional()
  @IsString()
  @Length(12, 128)
  password?: string;
}

export class UpdateMemberRoleDto {
  @IsString()
  @Length(1, 64)
  roleId!: string;
}

export class CreateRoleDto {
  @IsString()
  @Length(1, 80)
  name!: string;

  @IsString()
  @Length(1, 80)
  key!: string;

  @IsArray()
  @ArrayMinSize(0)
  @ArrayMaxSize(50)
  @IsString({ each: true })
  @Length(1, 100, { each: true })
  permissions!: string[];
}

export class UpdateRoleDto {
  @IsOptional()
  @IsString()
  @Length(1, 80)
  name?: string;

  @IsArray()
  @ArrayMinSize(0)
  @ArrayMaxSize(50)
  @IsString({ each: true })
  @Length(1, 100, { each: true })
  permissions?: string[];
}

export class UpdateMemberBranchesDto {
  @IsArray()
  @ArrayMaxSize(200)
  @IsString({ each: true })
  @Length(1, 64, { each: true })
  branchIds!: string[];
}

export class UpsertEmployeeProfileDto {
  @IsOptional()
  @IsString()
  @Length(1, 40)
  employeeNumber?: string | null;

  @IsOptional()
  @IsString()
  @Length(1, 120)
  jobTitle?: string | null;

  @IsOptional()
  @IsString()
  @Length(1, 120)
  department?: string | null;

  @IsOptional()
  @IsString()
  hiredAt?: string | null;

  @IsOptional()
  @IsIn(EMPLOYMENT_TYPES)
  employmentType?: (typeof EMPLOYMENT_TYPES)[number] | null;

  @IsOptional()
  @IsIn(EMPLOYEE_STATUSES)
  status?: (typeof EMPLOYEE_STATUSES)[number];

  @IsOptional()
  @IsString()
  endedAt?: string | null;

  @IsOptional()
  @IsBoolean()
  endEmployment?: boolean;
}
