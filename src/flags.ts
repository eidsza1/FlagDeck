import { createHash } from "node:crypto";

/** Operators supported by a targeting rule condition. */
export type Operator =
  | "eq"
  | "neq"
  | "in"
  | "not_in"
  | "contains"
  | "gt"
  | "gte"
  | "lt"
  | "lte";

/** A single condition compared against an attribute in the evaluation context. */
export interface Condition {
  /** Context attribute to compare, e.g. "email", "plan", "country". */
  attribute: string;
  operator: Operator;
  /** Values to compare against. For scalar operators the first value is used. */
  values: (string | number | boolean)[];
}

/**
 * A targeting rule. When every condition matches, the rule decides the result:
 * `serve` forces the flag on (true) or off (false) for the matching context.
 * Rules are evaluated in array order; the first match wins.
 */
export interface Rule {
  description?: string;
  conditions: Condition[];
  serve: boolean;
}

export interface Flag {
  key: string;
  description: string;
  /** Master switch. When false the flag always evaluates to false. */
  enabled: boolean;
  /** Percentage of traffic (0-100) that receives `true` when no rule matches. */
  rolloutPercentage: number;
  /** Ordered targeting rules; first match wins over the rollout. */
  rules: Rule[];
  createdAt: string;
  updatedAt: string;
}

/** Context describing the subject a flag is evaluated for. */
export interface EvalContext {
  /** Stable identifier used for sticky percentage bucketing. */
  userId?: string;
  /** Arbitrary attributes referenced by targeting rule conditions. */
  attributes?: Record<string, string | number | boolean>;
}

export interface EvalResult {
  key: string;
  value: boolean;
  /** Human-readable explanation of which path produced the value. */
  reason: string;
}

/**
 * Deterministically maps a (flagKey, identifier) pair into a bucket in [0, 100).
 * The same pair always yields the same bucket, so rollouts are sticky per user.
 */
export function bucket(flagKey: string, identifier: string): number {
  const hash = createHash("sha256").update(`${flagKey}:${identifier}`).digest();
  // Use the first 4 bytes as an unsigned 32-bit int, scaled to [0, 100).
  const int = hash.readUInt32BE(0);
  return (int / 0xffffffff) * 100;
}

function coerce(a: string | number | boolean): string | number {
  if (typeof a === "boolean") return a ? "true" : "false";
  return a;
}

function matchesCondition(
  condition: Condition,
  ctx: EvalContext
): boolean {
  const actual = ctx.attributes?.[condition.attribute];
  if (actual === undefined) return false;

  const a = coerce(actual);
  const vals = condition.values.map(coerce);

  switch (condition.operator) {
    case "eq":
      return a === vals[0];
    case "neq":
      return a !== vals[0];
    case "in":
      return vals.includes(a);
    case "not_in":
      return !vals.includes(a);
    case "contains":
      return String(a).includes(String(vals[0]));
    case "gt":
      return Number(a) > Number(vals[0]);
    case "gte":
      return Number(a) >= Number(vals[0]);
    case "lt":
      return Number(a) < Number(vals[0]);
    case "lte":
      return Number(a) <= Number(vals[0]);
    default:
      return false;
  }
}

function matchesRule(rule: Rule, ctx: EvalContext): boolean {
  // All conditions must match (logical AND).
  return rule.conditions.every((c) => matchesCondition(c, ctx));
}

/**
 * Evaluates a flag for the given context.
 *
 * Order of precedence:
 *  1. If the flag is disabled, return false.
 *  2. The first targeting rule whose conditions all match decides the result.
 *  3. Otherwise the percentage rollout decides, bucketed by userId (or "anonymous").
 */
export function evaluate(flag: Flag, ctx: EvalContext = {}): EvalResult {
  if (!flag.enabled) {
    return { key: flag.key, value: false, reason: "flag disabled" };
  }

  for (let i = 0; i < flag.rules.length; i++) {
    const rule = flag.rules[i];
    if (matchesRule(rule, ctx)) {
      return {
        key: flag.key,
        value: rule.serve,
        reason: `matched rule #${i + 1}${rule.description ? ` (${rule.description})` : ""} → serve ${rule.serve}`,
      };
    }
  }

  if (flag.rolloutPercentage >= 100) {
    return { key: flag.key, value: true, reason: "rollout 100%" };
  }
  if (flag.rolloutPercentage <= 0) {
    return { key: flag.key, value: false, reason: "rollout 0%" };
  }

  const identifier = ctx.userId ?? "anonymous";
  const b = bucket(flag.key, identifier);
  const value = b < flag.rolloutPercentage;
  return {
    key: flag.key,
    value,
    reason: `rollout ${flag.rolloutPercentage}% → bucket ${b.toFixed(2)} for "${identifier}" → ${value}`,
  };
}
