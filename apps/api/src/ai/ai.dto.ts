import { IsIn, IsOptional, IsString, Length, MaxLength } from "class-validator";

export const ASSISTANT_INTENTS = [
  "sales_summary",
  "low_stock",
  "top_products",
  "outstanding_receivables",
  "inventory_value",
] as const;

export type AssistantIntent = (typeof ASSISTANT_INTENTS)[number];

export class AssistantQueryDto {
  @IsIn(ASSISTANT_INTENTS)
  intent!: AssistantIntent;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  from?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  to?: string;
}

/**
 * A proposal is a *draft action* only. It records what the assistant suggests;
 * it never executes a write. Execution stays with the normal, authorized
 * business endpoints, which re-check permissions and idempotency.
 */
export const PROPOSAL_KINDS = ["create_sale", "record_payment", "adjust_stock"] as const;

export class CreateProposalDto {
  @IsIn(PROPOSAL_KINDS)
  kind!: (typeof PROPOSAL_KINDS)[number];

  @IsString()
  @Length(1, 2000)
  rationale!: string;

  /** Opaque draft payload the human will review; validated at execution time. */
  @IsString()
  @Length(2, 8000)
  payload!: string;
}
