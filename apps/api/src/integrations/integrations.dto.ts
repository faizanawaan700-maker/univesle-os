import {
  IsIn,
  IsOptional,
  IsString,
  Length,
  Matches,
  MaxLength,
} from "class-validator";

export class IngestEventDto {
  @IsString()
  @Length(1, 120)
  eventId!: string;

  @IsString()
  @Length(1, 120)
  eventType!: string;

  /** Raw JSON object from the provider; stored verbatim for audit and replay. */
  @IsString()
  @Length(2, 100_000)
  payload!: string;
}

export const CURRENCY_DISPLAY = ["symbol", "code", "name"] as const;

export class UpdateSettingsDto {
  @IsOptional()
  @IsString()
  @Matches(/^[a-zA-Z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/)
  @MaxLength(20)
  locale?: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  timeZone?: string;

  @IsOptional()
  @IsString()
  @Matches(/^[A-Z]{3}$/)
  currencyCode?: string;

  @IsOptional()
  @IsIn(CURRENCY_DISPLAY)
  currencyDisplay?: (typeof CURRENCY_DISPLAY)[number];
}
