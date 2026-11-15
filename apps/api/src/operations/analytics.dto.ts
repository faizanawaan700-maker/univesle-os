import { Type } from "class-transformer";
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
} from "class-validator";

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export const ANALYTICS_GROUPS = ["day", "product", "customer"] as const;

/**
 * Analytics window. Dates are inclusive calendar dates in UTC; all figures are
 * derived from stored invoices and movements, never estimated.
 */
export class AnalyticsQueryDto {
  @IsOptional()
  @IsString()
  @Matches(DATE_PATTERN)
  from?: string;

  @IsOptional()
  @IsString()
  @Matches(DATE_PATTERN)
  to?: string;

  @IsOptional()
  @IsIn(ANALYTICS_GROUPS)
  groupBy?: (typeof ANALYTICS_GROUPS)[number];

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(365)
  forecastDays?: number;
}
