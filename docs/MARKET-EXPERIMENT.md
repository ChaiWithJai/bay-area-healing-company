# Task-based value and pricing experiment

The product hypothesis is that a local workflow manager can produce verifiable administrative deliverables with less staff effort while keeping records on a user's machine. The current demonstration can establish technical feasibility on synthetic cases. It cannot yet establish willingness to pay, customer time saved, or production reliability.

## Unit of value

Measure each workflow separately, preserving its actual completion boundary:

| Workflow | Value unit | User acceptance boundary |
|---|---|---|
| Participation | Reconciled reporting period with source-backed hours and conflicts | Coordinator can approve the ledger and resolve surfaced conflicts |
| Case notes | Batch normalized to the organization’s schema | Every note accounted for, prohibited data excluded, exceptions actionable |
| Board report | Board packet for one reporting period | Finance/operations reviewer reconciles all numbers and signs off on explanations |
| Grant cycle | One application package under one RFP | Grant owner confirms requirements, claims, budget, and restrictions |
| Stewardship | Complete decision packet | Decision-maker has documented alternatives and unresolved issues; no legal approval implied |

Start the customer experiment with participation reconciliation: the three-source reconciliation and acceptance boundary are concrete. This is a sequencing hypothesis, not a claim that it has the largest market. Test remaining workflows once their actual users and review processes are identified.

## Paired baseline protocol

1. Obtain permission and a clear data-handling agreement for one real or de-identified historical source pack. Record provenance and ground truth before running either method.
2. Have a practitioner complete the task with their normal tools and record preparation, active execution, review, correction, and waiting separately. Document their familiarity with the material.
3. Run the local system on an equivalent pack with the same acceptance criteria. Counterbalance human-first versus system-first order across participants where feasible; reusing known answers biases time savings.
4. Have the same qualified reviewer, preferably blinded to production method, score correctness, missing evidence, and unresolved issues. Record review time and corrections through acceptance, including failed attempts.
5. Repeat across organizations and ordinary/problematic periods. Keep failed or abandoned runs in the denominator. Publish sample counts, source mix, model fingerprints, hardware, cold/warm state, and variation.

`human-baseline.csv` is a blank capture template. Use stable pseudonymous IDs and references to private source packs, not personal records inside the CSV. Record unavailable values as blank. An empty baseline is no evidence of time savings.

## Metrics and accounting

- **Accepted deliverable rate:** accepted workflow outputs / attempted workflow tasks. Report correct review/abstention separately; it is useful behavior but not a completed grant or reconciled dataset.
- **Staff minutes per accepted deliverable:** all preparation, operation, review, correction, and escalation minutes across attempted tasks / accepted outputs. Include model failures and user retries.
- **Elapsed latency:** report cold and warm p50/range initially; use tail percentiles only with enough observations. Include setup and queue time separately from model execution.
- **Quality:** incorrect accepted claims, omitted records, missed conflicts, false exception rate, citation support, and domain-review findings. Averages must not hide consequential errors.
- **Hardware demand:** model/runtime profile, context, reported tokens with coverage, load/generation time, coordinator RSS, server process-tree RSS, host swap, and pressure. RSS is not total Apple Silicon model memory; keep loaded-model size separate.
- **Operating economics:** local-only configuration establishes no configured paid inference API, not zero total cost. Electricity, hardware amortization, maintenance, support, and labor remain unknown until measured or explicitly modeled. Codex subscription development consumption is a separate build expense, never a runtime per-task charge.

Compute observed staff time saved only after matched baseline evidence exists. A money conversion uses the customer's stated fully loaded hourly cost and must show that assumption. Cash savings require evidence that freed time changes expenditure; otherwise report capacity released. Do not invent ROI or multiply a synthetic throughput result by an assumed customer population.

## Pricing hypotheses to test

Test willingness to pay for an explicitly bounded pilot before choosing prices. Present a concrete deliverable, data boundary, supported input formats, expected review work, and failure handling.

- **Per accepted reporting package:** may match occasional participation/board/grant work; track support and input-cleaning effort before setting a fee.
- **Monthly local software/support:** may suit repeat users; test whether recurring use and updates justify a subscription despite zero paid runtime inference APIs.
- **Setup plus maintenance:** may fit organizations needing schema mapping and policy configuration; separate reusable product work from bespoke consulting.

These are alternatives to compare, not validated offers. Capture the buyer's budget owner, current process cost, purchase trigger, preferred unit, stated acceptable price range, and an actual paid-pilot decision. A compliment or hypothetical willingness-to-pay answer is not a purchase. Do not publish invented market size, pricing benchmarks, or revenue forecasts.

## Evidence needed before marketing claims

A publishable case study needs source permissions, dated task specification, independently reviewed output, an observed human baseline, hardware/model/runtime fingerprints, full failure accounting, and a reproducible measurement method. Report ranges and limits. Replace “handles all administrative work” with the exact workflow and conditions demonstrated. Keep synthetic demonstration results visibly separate from customer evidence and keep unresolved review/decision work visible in both the product and the sales description.
