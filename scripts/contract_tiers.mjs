import crypto from "node:crypto";

/**
 * Contract tier definitions.
 *
 * The frozen contract is split into two tiers so that implementation-only
 * amendments (source file bytes) do not invalidate training state:
 *
 * 1. Scientific invariants — fields whose change invalidates checkpoints
 *    as today.  These are the fields that affect training determinism:
 *    SPEC, gates, training parameters, data hashes, seeds, model
 *    architecture, treatment, evaluation, claim boundary, and sealed-test
 *    policy.
 *
 * 2. Implementation artifacts — source file hashes (trainer, importer,
 *    evaluator, runner, c51_evaluator).  These may be amended via a
 *    field-set diff that proves no scientific field changed.
 *
 * Checkpoints bind the scientific hash, so implementation-only amendments
 * keep resume valid.
 */

const SCIENTIFIC_FIELDS = Object.freeze([
  "schema",
  "experiment",
  "ilxyr",
  "specification",
  "braid",
  "control",
  "verified_target_import",
  "inputs",
  "model",
  "treatment",
  "training",
  "evaluation",
  "gates",
  "claim_boundary",
  "test",
]);

const IMPLEMENTATION_FIELDS = Object.freeze([
  "implementation",
]);

const METADATA_FIELDS = Object.freeze([
  "status",
  "authorized",
  "authorization",
  "contract_tiers",
]);

export function scientificFields() {
  return [...SCIENTIFIC_FIELDS];
}

export function implementationFields() {
  return [...IMPLEMENTATION_FIELDS];
}

function stableSerialize(value) {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(stableSerialize);
  return Object.keys(value).sort().reduce((acc, key) => {
    acc[key] = stableSerialize(value[key]);
    return acc;
  }, {});
}

export function scientificSubset(contract) {
  const subset = {};
  for (const field of SCIENTIFIC_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(contract, field)) {
      subset[field] = contract[field];
    }
  }
  return subset;
}

export function implementationSubset(contract) {
  const subset = {};
  for (const field of IMPLEMENTATION_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(contract, field)) {
      subset[field] = contract[field];
    }
  }
  return subset;
}

export function scientificHash(contract) {
  return crypto.createHash("sha256")
    .update(JSON.stringify(stableSerialize(scientificSubset(contract))))
    .digest("hex");
}

export function implementationHash(contract) {
  return crypto.createHash("sha256")
    .update(JSON.stringify(stableSerialize(implementationSubset(contract))))
    .digest("hex");
}

/**
 * Field-set diff checker.
 *
 * Given a previous and amended contract, returns a report describing which
 * scientific and implementation fields changed.  An amendment is valid for
 * checkpoint resume if and only if no scientific field changed.
 */
export function diffContracts(previous, amended) {
  const changedScientific = [];
  const changedImplementation = [];
  const changedMetadata = [];

  for (const field of SCIENTIFIC_FIELDS) {
    const prev = JSON.stringify(stableSerialize(previous[field]));
    const next = JSON.stringify(stableSerialize(amended[field]));
    if (prev !== next) changedScientific.push(field);
  }

  for (const field of IMPLEMENTATION_FIELDS) {
    const prev = JSON.stringify(stableSerialize(previous[field]));
    const next = JSON.stringify(stableSerialize(amended[field]));
    if (prev !== next) changedImplementation.push(field);
  }

  for (const field of METADATA_FIELDS) {
    const prev = JSON.stringify(stableSerialize(previous[field]));
    const next = JSON.stringify(stableSerialize(amended[field]));
    if (prev !== next) changedMetadata.push(field);
  }

  const scientificUnchanged = changedScientific.length === 0;
  return {
    scientific_unchanged: scientificUnchanged,
    resume_valid: scientificUnchanged,
    changed_scientific_fields: changedScientific,
    changed_implementation_fields: changedImplementation,
    changed_metadata_fields: changedMetadata,
    previous_scientific_hash: scientificHash(previous),
    amended_scientific_hash: scientificHash(amended),
    previous_implementation_hash: implementationHash(previous),
    amended_implementation_hash: implementationHash(amended),
  };
}
