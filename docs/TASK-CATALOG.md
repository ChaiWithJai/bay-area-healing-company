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

**Participation:** scheduler CSV and self-reported XLSX use `person_id`, `shift_id`, `hours`. PDF sign-ins contain those fields. Model-extracted quotes must substantiate every value and account for tabular sign-in lines. A unique person/shift is accepted only with agreement from at least two source types. Conflicting or single-source pairs carry no accepted hours and appear in `conflicts.tsv`. Repeated identical scheduler rows do not multiply hours. Outputs are `hours_ledger.tsv`, `conflicts.tsv` and `funder_rollup.tsv`.

**Cases:** `notes_raw/` contains the encounter documents, with `target_schema.json` and `pii_policy.json`. The model contributes extracted date, service, outcome and exact supporting quote. Current target fields are fixed to these values plus source and note identifiers. Names labeled `Name:`, email addresses, phone patterns and extra fields are rejected. These checks are deliberately bounded; they are not a general-purpose PII detector. Missing or contradictory outcomes become exceptions. Outputs are `normalized_cases.tsv` and `exceptions.tsv`; report normalized and exception counts separately.

**Board:** metrics CSV has `quarter`, `participants`, `sessions`; financial XLSX has `quarter`, `category`, `budget`, `actual`. `prior_risks.json` carries existing risks; prior PDF and charter are retained source documents. The model selects quarter-specific explanations from management updates. Narrative quantities must appear in that quarter's metric record; financial prose is generated from integer-cent calculations. Prior risks remain explicitly retained, because this version does not infer authorized resolutions. Outputs are `board_packet.pdf`, `variance.tsv` and `risk_register_diff.tsv`.

**Grants:** RFP PDF requirements have explicit IDs such as `R1:` on separate lines. Program evidence supplies requested claims; the model chooses a source sentence per requirement. Verification checks source inclusion and required subject terms, a conservative lexical check rather than semantic proof. Budget XLSX uses `category`, `fund`, `amount`. Restrictions supply `expected_total` and `unrestricted_only`; variance tolerance is 0.5 percent. Outputs are `application/narrative.docx`, `application/budget.xlsx` and `output/compliance_crosswalk.tsv`. A missing requirement or prohibited charge blocks acceptance.

**Stewardship:** asset and decision-right JSON files explicitly state proposed owners, consent status, authority and independence. Supplied structuring references contain dated fiscal-sponsorship and standalone-nonprofit alternatives. The model extracts those comparison paragraphs; no external legal research occurs at runtime. The packet includes a decision memo, transfer inventory, proposed fund-use policy, and governance matrix. Owner gaps or missing option evidence fail gates. Even a complete packet requires a human decision; no transfer, incorporation, expenditure, or assertion of tax status is performed.

Every workflow also writes `output/evidence.json`. Missing or invalid model work fails the model-completion gate. Source extraction errors remain visible. Domain gate ratio is separate from hidden-reference accuracy. A high ratio cannot convert an exception-only result into a completed substantive deliverable.

## Verification and interpretation

`test/domain.test.js` supplies explicitly controlled responses to test domain calculations, provenance checks, exception handling, and artifact output. Those tests do **not** demonstrate actual model capability. Real inference runs must separately record model fingerprints, prompt configuration, tokens, time, resource metrics, retries, exceptions and gate outcomes.

Before marketing claims, compare generated artifacts against the held-out reference fields, inspect representative native documents, retain failures, and record the reviewer status. Report sample sizes, cold/warm behavior and failed-attempt resource cost. A human time-saved claim requires a measured human baseline. Broader professional reliability requires richer, independently reviewed source material and acceptance rules.
