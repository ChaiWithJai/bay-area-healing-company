# Five workflow examination catalog

This suite evaluates the local workflow manager as a system: input extraction, local inference, deterministic calculations, verification, and native document generation. It contains 30 labeled synthetic task instances. It is **ALE-inspired, not an official ALE benchmark or a production reliability claim**.

## Selection and prior art

[Agents' Last Exam](https://agents-last-exam.org/docs/ale/index.html) emphasizes professional deliverables, reproducible environments, hidden reference grading, and retained execution trajectories. We borrow those design principles. Our first fixtures are generated scenarios, not ALE's expert-curated real data. The short extraction work units test our deliberately constrained harness, not an agent's unrestricted ability to perform the whole occupation.

| Workflow | Why selected | Adjacent ALE precedent |
|---|---|---|
| Participation reconciliation | High-volume record joins, OCR, duplicate and conflict handling; verifiable totals | [Gradebook closeout reconciliation](https://github.com/rdi-berkeley/agents-last-exam/tree/main/tasks/education_info/moodle_gradebook_closeout_reconciliation) |
| Case note normalization | Forty notes in three formats, source-span accountability, prohibited contact fields, ambiguous outcomes | No direct ALE case-documentation equivalence claimed; general deliverable and reference discipline |
| Board reporting | Reconcile four quarters and retain risk accountability across a rendered packet | [Financial statement reconstruction](https://github.com/rdi-berkeley/agents-last-exam/tree/main/tasks/business_finance/financial_stmt_reconstruction_aapl_fy2024) |
| Grant cycle package | Evidence crosswalk plus reconciled restricted budget and usable office artifacts | [Cross-document consistency audit](https://github.com/rdi-berkeley/agents-last-exam/tree/main/tasks/business_finance/legal_ma_consistency_audit_01) |
| Stewardship structuring | Asset ownership, independent oversight and grounded alternatives; explicit human decisions | [Governance classification](https://github.com/rdi-berkeley/agents-last-exam/tree/main/tasks/legal/agora_governance_classify_instance_1), an adjacent task rather than fiscal-sponsorship validation |

## Task organization

Every workflow has instances `01` through `06` under `fixtures/tasks/<workflow>-NN/`:

| Suffix | Split | Scenario |
|---|---|---|
| 01 | Development | Ordinary complete records; participation includes a raster-only PDF |
| 02 | Development | Conflicting source hours, contradictory case outcomes, narrative/metric disagreement, forbidden restricted charge, or unresolved contributor consent |
| 03 | Development | Missing required source, case outcome, quarterly explanation, RFP evidence, or owner/option evidence |
| 04 | Held out | Ordinary records with changed figures and dates |
| 05 | Held out | Conflict case with changed figures and dates |
| 06 | Held out | Missing-evidence case with changed figures and dates |

`task.json` records task identity, split, provenance, scenario and intended outcome class. `inputs/` is the only material available to workflow execution. Sibling `reference.json` contains grading targets and must never enter model prompts. `fixtures/catalog.json` lists the suite. Held-out cases are close perturbations, so performance on them is not strong evidence of generalization to other organizations.

All current records and reference answers have status `generated_unreviewed`. A passing automated test does not change that label. No public operational dataset, real beneficiary information, domain-expert approval, or legal review is implied. An external reviewer must review source correctness, expected outcomes and the scoring rubric before these become reviewed qualification tasks. Public or de-identified operational records can replace future inputs with explicit provenance and licensing.

Regenerate with `WM_PYTHON=/path/to/bundled/python3 node fixtures/generate.mjs`. The interpreter needs python-docx, openpyxl, Pillow and reportlab. The first volunteer fixture needs local Tesseract/Poppler for OCR. Generated Office and PDF files are genuine binary formats; the raster PDF has no embedded text layer. Fixture document metadata may differ between generations; run manifests retain the actual file hashes.

## Inputs and acceptance contracts

**Participation:** scheduler CSV and self-reported XLSX use `person_id`, `shift_id`, `hours`. PDF sign-ins contain those fields. Model-extracted quotes must substantiate every value and account for tabular sign-in lines. A unique person/shift is accepted only with agreement from the required number of distinct source types. Supported hour rules default to two; `min_sources` supports one through three. Multiple scanned pages are one source type. Unknown metric rules or units fail closed. Conflicting pairs or pairs below the required source-type count carry no accepted hours and appear in `conflicts.tsv`. Repeated identical scheduler rows do not multiply hours. Outputs are `hours_ledger.tsv`, `conflicts.tsv` and `funder_rollup.tsv`.

**Cases:** `notes_raw/` contains the encounter documents, with `target_schema.json` and `pii_policy.json`. The model contributes extracted date, service, outcome and exact supporting quote. The supported target-field subset is `note_id`, `date`, `service`, `outcome`, `source_id`, and `quote`; supplied required/permitted fields and expected note counts are enforced, and unsupported schemas block acceptance. Labeled prohibited values are removed from the model prompt without altering original evidence. Each quote is constrained to one contiguous clean source block; separate blocks are never joined across private spans. Names, labeled prohibited values, email addresses, phone patterns, unsupported values, and extra fields are rejected. Visible required fields cannot silently become valid missing-data exceptions. These checks are bounded, not a general-purpose PII detector. Missing or contradictory outcomes become exceptions; evidence requiring unsupported multiple spans remains blocked/review work. Outputs are `normalized_cases.tsv` and `exceptions.tsv`; report normalized and exception counts separately.

**Board:** metrics CSV has `quarter`, `participants`, `sessions`; financial XLSX has `quarter`, `category`, `budget`, `actual`. `prior_risks.json` carries existing risks; explicit `RISK-*` identifiers and descriptions must reconcile to the prior PDF, and the charter remains a source document. Unsupported prior-register formats require review. The model selects quarter-specific explanations from management updates. Every narrative quantity must appear in that quarter's `variance.tsv` rows. The table preserves financial columns and adds metric rows, distinguished by `record_type`, with `source_id` provenance. Financial prose is generated from integer-cent calculations. Prior risks remain explicitly retained, because this version does not infer authorized resolutions. Outputs are `board_packet.pdf`, `variance.tsv` and `risk_register_diff.tsv`.

**Grants:** RFP PDF requirements have explicit IDs such as `R1:` on separate lines. Program evidence supplies requested claims; the model chooses a source sentence per requirement. Verification checks source inclusion and required subject terms, a conservative lexical check rather than semantic proof. Budget XLSX uses `category`, `fund`, `amount`. Supported restrictions supply `expected_total`, `unrestricted_only`, and optional `currency`; unknown rule keys block acceptance. Variance tolerance is 0.5 percent, and budget lines require finite nonnegative amounts plus category/fund labels. Every explicit RFP ID must be captured. The reporting template and annual return contextualize extraction; recognized revenue/program-expense claims are checked for contradictions against the supplied return. This is bounded consistency checking, not a complete audit of a Form 990. Outputs are `application/narrative.docx`, `application/budget.xlsx` and `output/compliance_crosswalk.tsv`. A missing requirement or prohibited charge blocks acceptance.

**Stewardship:** asset and decision-right JSON files explicitly state proposed owners, consent status, authority and independence. Supplied structuring references contain dated fiscal-sponsorship and standalone-nonprofit alternatives. The model extracts those comparison paragraphs; no external legal research occurs at runtime. The packet includes a decision memo, transfer inventory, proposed fund-use policy, and governance matrix. Host fees, dates, and jurisdiction are carried into the memo and checked against sponsorship evidence. Contributor identities support founder-independence checks; an `independent: true` flag alone is insufficient. The fund-use policy reproduces supplied intent, whose explicit founder-benefit exclusion is required. Both options must address first-tax-deductible-funds timing or uncertainty, reversibility, and succession. Owner gaps or missing option evidence fail gates. Even a complete packet requires a human decision; no transfer, incorporation, expenditure, or assertion of tax status is performed.

Every workflow also writes `output/evidence.json`. Missing or invalid model work fails the model-completion gate. Source extraction errors remain visible. Domain gate ratio is separate from hidden-reference accuracy. A high ratio cannot convert an exception-only result into a completed substantive deliverable.

## Verification and interpretation

`test/domain.test.js` supplies explicitly controlled responses to test domain calculations, provenance checks, exception handling, and artifact output. Those tests do **not** demonstrate actual model capability. Real inference runs must separately record model fingerprints, prompt configuration, tokens, time, resource metrics, retries, exceptions and gate outcomes.

Before marketing claims, compare generated artifacts against the held-out reference fields, inspect representative native documents, retain failures, and record the reviewer status. Report sample sizes, cold/warm behavior and failed-attempt resource cost. A human time-saved claim requires a measured human baseline. Broader professional reliability requires richer, independently reviewed source material and acceptance rules.
