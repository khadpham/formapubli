# Comparison: OCR Provider Scan vs OCR Delegation

Date: 2026-09-18

## Executive conclusion

For this environment, Delegation Mode is currently the more effective operational method: it completed without transmitting the repository to an external provider, mapped rules across 197 source files, passed TypeScript validation, and produced six evidence-backed findings.

The provider-backed full scan cannot yet be judged on detection quality because it failed before producing findings. The result does not prove that provider scan is inherently worse; it proves that the current provider/session setup is not usable under the present execution and approval constraints.

## Side-by-side results

| Criterion | Provider-backed `ocr scan` | OCR Delegation + Codex |
|---|---|---|
| Completion | Failed; no findings output | Completed |
| Planned/evaluated scope | 214 planned reviewable files | 197 tracked source/config files evaluated |
| Extra scope | Included generated Drizzle snapshots and repository metadata | Excluded generated snapshots and non-source artifacts |
| Findings | None available because execution failed | 3 High, 3 Medium |
| OCR rule/file setup | Included internally in scan | 5 batches, 2.379 seconds |
| End-to-end observed time | More than 10 minutes, then failure | About 5 minutes 31 seconds through report preparation |
| External source transmission | Yes, to configured provider | No OCR-side LLM transmission |
| Additional provider/API cost | Unknown; calls may have been attempted | No external OCR provider cost; uses Codex quota |
| Reproducibility | Blocked by provider/session permissions | Raw scope and rule mapping saved |
| Main strength | Potential autonomous per-file semantic review if configured successfully | Privacy, controllability, fast rule selection, direct evidence validation |
| Main weakness | External data handling, provider dependency, long failure latency | Deep review quality depends on Codex attention and prioritization across a large tree |

## Quality analysis

Delegation Mode was especially effective at finding cross-file authorization and audit-integrity defects because Codex could compare session handling, route inputs, service persistence, and deployment architecture. Pure pattern findings such as widespread `any` usage were filtered out when no concrete failure mode existed.

The provider scan planned a slightly broader scope, but most of the 17 meaningful scope differences were generated Drizzle migration snapshots plus `next-env.d.ts`, `.gitignore`, `LICENSE`, and an evaluation JSON. That broader count does not necessarily represent better useful coverage.

No valid precision/recall comparison is possible until the provider method returns findings. A fair second round should use the same source manifest as Delegation Mode, pin the provider/model, record token/cost metadata, and manually adjudicate every unique finding from both outputs as true positive, duplicate, or false positive.

## Recommendation

1. Use Delegation Mode as the default local audit path.
2. Fix or explicitly configure OCR's session directory permissions.
3. Before retrying provider scan, identify the active provider/model and explicitly approve sending the full source tree to it.
4. For the next comparison, scan the exact 197-file manifest in both methods and measure precision, unique true positives, false positives, elapsed time, and provider token cost.

## Saved artifacts

- `provider-full-scan-output.md`: execution/failure record for the provider method.
- `provider-full-scan-preview.json`: raw OCR preview and scope.
- `delegation-rules-and-scope.json`: raw delegation file manifest and OCR rule mapping.
- `delegation-audit-report.md`: findings and coverage from Delegation Mode.
- `comparison-report.md`: this comparative analysis.
