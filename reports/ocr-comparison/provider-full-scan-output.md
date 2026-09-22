# OCR Provider Full Scan — Execution Output

Date: 2026-09-18
Repository: `D:/Data Project/formapubli`
Requested mode: `ocr scan` using the configured external provider
Mutation policy: report only; no source edits

## Preview

- Files discovered before report artifacts were created: 286
- Planned reviewable files: 214
- Excluded or unsupported files: 72
- Approximate input size reported by OCR: 69,657 lines
- Exclusions: `.env*`, `*.db*`, `node_modules`, `.next`, `.vercel`, `dist`, `build`, `coverage`, and generated directories

The reproducible preview after excluding `reports/**` is stored in `provider-full-scan-preview.json`. It contains the current repository inventory, including the newly created comparison artifacts as excluded paths; its reviewable count remains 214.

## Execution result

The provider-backed scan did not produce review findings.

OCR returned:

```text
Error: scan failed: all 214 file scan(s) failed — check your LLM configuration and API key
finalize session: create session writer: open session file: open C:\Users\PC\.opencodereview\sessions\D_Data Project-formapubli\3b7bf847-6d4f-45b3-9331-281993c9b963.jsonl: Access is denied.
```

The run lasted more than ten minutes before failing. No final JSON output file was created. Because failure occurred after OCR attempted the scan, it is unknown whether the configured provider charged any requests.

## Retry status

An outside-sandbox retry was not executed. The environment blocked it because it would transmit the complete project source to an externally configured provider whose destination was not identified in the approval context.

To retry safely, identify the active provider and model, confirm that sending the full source tree to that destination is acceptable, and then explicitly approve the external scan. Do not infer review quality from this failed run.
