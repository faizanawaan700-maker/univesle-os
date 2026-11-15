import { IsString, Length } from "class-validator";

export class CreateOrganizationDto {
  @IsString()
  @Length(1, 160)
  name!: string;
}
