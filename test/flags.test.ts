import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluate, bucket, type Flag } from "../src/flags.ts";

function makeFlag(overrides: Partial<Flag> = {}): Flag {
  return {
    key: "test.flag",
    description: "",
    enabled: true,
    rolloutPercentage: 0,
    rules: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

test("disabled flag always evaluates false", () => {
  const flag = makeFlag({ enabled: false, rolloutPercentage: 100 });
  assert.equal(evaluate(flag).value, false);
});

test("100% rollout serves true", () => {
  const flag = makeFlag({ rolloutPercentage: 100 });
  assert.equal(evaluate(flag, { userId: "u1" }).value, true);
});

test("0% rollout serves false", () => {
  const flag = makeFlag({ rolloutPercentage: 0 });
  assert.equal(evaluate(flag, { userId: "u1" }).value, false);
});

test("rollout bucketing is deterministic and sticky", () => {
  const flag = makeFlag({ rolloutPercentage: 50 });
  const first = evaluate(flag, { userId: "stable-user" }).value;
  const second = evaluate(flag, { userId: "stable-user" }).value;
  assert.equal(first, second);
});

test("bucket stays within [0, 100)", () => {
  for (const id of ["a", "b", "c", "12345", "x".repeat(50)]) {
    const b = bucket("flag", id);
    assert.ok(b >= 0 && b < 100, `bucket ${b} out of range`);
  }
});

test("targeting rule overrides rollout", () => {
  const flag = makeFlag({
    rolloutPercentage: 0,
    rules: [
      {
        description: "pro users",
        conditions: [{ attribute: "plan", operator: "eq", values: ["pro"] }],
        serve: true,
      },
    ],
  });
  assert.equal(evaluate(flag, { attributes: { plan: "pro" } }).value, true);
  assert.equal(evaluate(flag, { attributes: { plan: "free" } }).value, false);
});

test("first matching rule wins", () => {
  const flag = makeFlag({
    rules: [
      {
        conditions: [{ attribute: "country", operator: "eq", values: ["US"] }],
        serve: false,
      },
      {
        conditions: [{ attribute: "plan", operator: "eq", values: ["pro"] }],
        serve: true,
      },
    ],
  });
  const r = evaluate(flag, { attributes: { country: "US", plan: "pro" } });
  assert.equal(r.value, false);
});

test("in / not_in operators", () => {
  const flag = makeFlag({
    rules: [
      {
        conditions: [{ attribute: "country", operator: "in", values: ["US", "CA"] }],
        serve: true,
      },
    ],
  });
  assert.equal(evaluate(flag, { attributes: { country: "CA" } }).value, true);
  assert.equal(evaluate(flag, { attributes: { country: "DE" } }).value, false);
});

test("numeric comparison operators", () => {
  const flag = makeFlag({
    rules: [
      {
        conditions: [{ attribute: "age", operator: "gte", values: [18] }],
        serve: true,
      },
    ],
  });
  assert.equal(evaluate(flag, { attributes: { age: 21 } }).value, true);
  assert.equal(evaluate(flag, { attributes: { age: 16 } }).value, false);
});

test("all conditions in a rule must match (AND)", () => {
  const flag = makeFlag({
    rules: [
      {
        conditions: [
          { attribute: "plan", operator: "eq", values: ["pro"] },
          { attribute: "country", operator: "eq", values: ["US"] },
        ],
        serve: true,
      },
    ],
  });
  assert.equal(
    evaluate(flag, { attributes: { plan: "pro", country: "US" } }).value,
    true
  );
  assert.equal(
    evaluate(flag, { attributes: { plan: "pro", country: "DE" } }).value,
    false
  );
});
