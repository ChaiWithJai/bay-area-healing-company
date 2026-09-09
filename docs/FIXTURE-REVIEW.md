# Automated fixture source/reference audit

Reviewed 2026-09-06. This is an automated source/reference consistency audit, not human review, expert endorsement, legal validation, an ALE benchmark result, or evidence of customer demand. Leave `generated_unreviewed` provenance unchanged until a qualified human actually reviews the tasks.

## Result and reproducibility

All 30 task cards matched the catalog. A separate deterministic parser ran 96 checks against source inputs and supplied references: **96 passed, zero mismatches**. Reproduce with `python3 docs/fixture-audit.py`; it requires openpyxl, pdftotext, pdftoppm, and tesseract. The script reads fixtures and writes its summary to stdout; its OCR intermediate files use a temporary directory. It does not run the workflow engine, modify fixtures, or call a model.

The audit implementation is separate from the generator and runtime/grader. The agent inspected their code, so this is not a blinded independent review and correlated interpretation errors remain possible. Passing exact arithmetic/field checks does not verify professional usefulness.

| Workflow | Source-derived checks, across six tasks | Finding |
|---|---|---|
| Participation | Deduplicated person/shift pairs, distinct source-type agreement, conflicting values, accepted hours | Reference hours, disagreement counts, and three-shift counts match. The first development PDF requires OCR; its three rows were independently recovered. |
| Case normalization | All 240 note records; dates, service text, three formatting patterns, missing/conflicting outcomes | Every reference field and exception matches the source. Both conflict variants identify contradictory outcomes, not an invented resolution. |
| Board reporting | Every spreadsheet budget, actual, arithmetic variance, and prior risk ID | Reference variance rows and risk identities match sources. This does not assess quality or completeness of explanatory prose. |
| Grants | RFP requirement IDs extracted from PDF, budget sums, prohibited fund/category allocations | All references match the fixture RFP and restriction file. Restrictions are scenario rules, not externally verified grant requirements. |
| Stewardship | Asset identities and unresolved consent/owner counts | References match source inventories. This does not validate legal advice, host terms, independence, fee levels, or enforceability. |

The 96 count includes one catalog/card equality check per task and one combined complete-record comparison per case-note task; it is not a count of statistically independent assertions or professional decisions.

## Material limitations and ambiguities

- **All 30 are synthetic and generated together.** There are no public historical RFPs, de-identified operational records, actual board packets, or documented expert assessments in this suite. The requested mixed-provenance validation remains a gap.
- The 15 held-out tasks reuse development templates with small value/date changes. They measure behavior on reserved instances, not unseen organizations or document distributions. Stewardship held-out input files are byte-for-byte identical to their corresponding development inputs: all six files per variant match. Treat stewardship held-out results as repeatability evidence, not generalization.
- Participation has three unique shifts per case and one raster input in the suite. It does not establish scale, handwriting tolerance, ambiguous names, realistic time intervals, or broad OCR reliability.
- Case notes number 40 per task, but are short templated records with three formats and predictable identities. This tests coverage and constrained normalization, not unrestricted narrative understanding.
- Board reports contain four financial rows and two risks; grants contain three requirements and two budget rows. These are useful integration exercises, not representative organizational complexity.
- Stewardship’s ordinary task card says `expected_result: complete`, while its reference requires a human decision and the grader expects review. Interpret complete as a completed **review packet**, never an approved structure or enacted transfer. Report this separately from automated final decisions.
- Case-note references express empty outcome for both missing and contradictory cases; source inspection is needed to distinguish the exception reason. The artifact grader accepts an exception row without verifying its precise reason. This audit confirms that an exception is warranted but does not strengthen that grader automatically.
- The existing grader verifies many exact fields and native artifacts, but does not fully grade narrative persuasiveness, every evidence quotation’s semantic entailment, all PII types, or legal accuracy. Generated references and graders can share assumptions; passing them cannot eliminate those blind spots.

## What is useful about the ALE influence

The suite evaluates a requested deliverable, not a trivia answer. It combines files, tools, calculations, citation/evidence handling, recovery, and observable exceptions. Independent artifact comparisons and negative variants reduce the chance that a fluent response is mistaken for success. Those are useful ALE-inspired design choices.

The current difficulty, provenance, professional review, and held-out diversity are not equivalent to ALE. Do not advertise an ALE score, professional qualification, or enterprise reliability based on these results.

## Next evidence milestone

Acquire consented or public source packs with explicit licenses and provenance before claiming external validity. For each workflow, commission one domain practitioner to specify acceptance criteria and independently mark one development pack plus at least two unseen evaluation packs. Keep complete organizations/time periods out of development, not just individual files. Include realistic volume, document-quality variation, and deliberately absent evidence. For stewardship, evaluate completeness of a decision packet under supplied dated rules with an appropriately qualified reviewer; do not grade legal outcomes by model judgment.

Retain these synthetic tasks as regression cases. Record professional review date, reviewer role, disagreements, adjudication, and changed assumptions separately; never relabel the present automated audit as human review.
