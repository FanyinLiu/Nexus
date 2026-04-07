import type { ConstraintCheck, ConstraintSet, HarnessDomain } from './types.ts'

export function createConstraintSet<T>(
  domain: HarnessDomain,
  checks: ConstraintCheck<T>[],
): ConstraintSet<T> {
  return { domain, checks }
}

export function applyConstraints<T>(
  payload: T,
  candidateId: string,
  targetDomain: HarnessDomain,
  constraintSets: ConstraintSet<T>[],
): { payload: T; applied: string[] } {
  let current = payload
  const applied: string[] = []

  for (const set of constraintSets) {
    if (set.domain !== targetDomain) {
      continue
    }

    for (const check of set.checks) {
      const next = check.apply(current, candidateId)
      if (next !== current) {
        applied.push(check.key)
      }
      current = next
    }
  }

  return { payload: current, applied }
}

/** Detect constraints that reference a domain outside their own set (heuristic check on key prefixes). */
export function validateConstraintIsolation<T>(
  sets: ConstraintSet<T>[],
): Array<{ key: string; declaredDomain: HarnessDomain }> {
  const violations: Array<{ key: string; declaredDomain: HarnessDomain }> = []
  const knownDomains = new Set(sets.map((s) => s.domain))

  for (const set of sets) {
    for (const check of set.checks) {
      for (const domain of knownDomains) {
        if (domain !== set.domain && check.key.startsWith(domain + ':')) {
          violations.push({ key: check.key, declaredDomain: set.domain })
        }
      }
    }
  }

  return violations
}
