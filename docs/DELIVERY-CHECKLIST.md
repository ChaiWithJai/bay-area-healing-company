# Delivery contract

This laptop is the first worker and test environment. Codex/Astra architects, implements, reviews and repairs the software as development tooling. The application itself never calls Codex or a paid inference service. A later fleet can host additional models; it does not change evidence or acceptance requirements.

| Milestone | Acceptance evidence |
| --- | --- |
| Local execution boundary | Loopback-only profiles, redirect and remote-model rejection; runtime tests |
| Five complete workflow paths | Source extraction → bounded structured model work → native artifacts → domain gates |
| Correct failure behavior | Unsupported schema, contradictory facts, prohibited PII, missing data and unimplemented gates block or create review packets |
| Durable coordination | SQLite state/events, inference lease, input/config/plan fingerprints, checkpoint reuse, cancellation |
| Comparable model evaluation | Development/heldout separation, fixed repetitions, fallback disabled for model baselines, independent artifact grading |
| Accounted consumption | Attempts including failures, token coverage, timing, process memory, host pressure, separate qualification/development records |
| Reproducible installation | Node + Python requirements, local runtime setup, CI without model downloads or inference credentials |
| Demonstration | Five ordinary local runs checked against references, with stewardship explicitly a review draft |
| Honest product evidence | Synthetic provenance, repeatability distinguished from generalization, human time/cost baselines left unmeasured |
| Reviewable delivery | Isolated branch and pull request; no merge |

The initial fixture suite has no real beneficiary records. Historical deidentified data and independent domain-expert review require a later permissioned pilot. This limitation must accompany any demonstration or benchmark claim. Neither source-backed drafts nor successful synthetic tests establish legal, accounting or grant-review expertise.
