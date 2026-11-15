import {
  IsEmail,
  IsString,
  Length,
  MaxLength,
  MinLength,
} from "class-validator";

export class RegisterDto {
  @IsEmail()
  @MaxLength(320)
  email!: string;

  @IsString()
  @MinLength(12)
  @MaxLength(128)
  password!: string;

  @IsString()
  @Length(1, 120)
  name!: string;

  @IsString()
  @Length(1, 160)
  organizationName!: string;
}

export class LoginDto {
  @IsEmail()
  @MaxLength(320)
  email!: string;

  @IsString()
  @MinLength(12)
  @MaxLength(128)
  password!: string;
}
