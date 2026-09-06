# Local demonstration packet

These are the actual ordinary-case outputs from Bonsai 8B development campaign `dev-bonsai8-v4` on the M4 Pro laptop. All five independently matched their synthetic references. `demo-provenance.json` in each folder identifies the run, code digest and measured inference usage. Sources are the corresponding `fixtures/tasks/*-01/inputs` files.

- Grant: [narrative](grant_cycle_package/application/narrative.docx), [budget](grant_cycle_package/application/budget.xlsx), [crosswalk](grant_cycle_package/output/compliance_crosswalk.tsv).
- Cases: [40 normalized notes](case_note_normalization/output/normalized_cases.tsv), [exceptions](case_note_normalization/output/exceptions.tsv).
- Board: [packet](board_report_synthesis/output/board_packet.pdf), [variance](board_report_synthesis/output/variance.tsv), [risk changes](board_report_synthesis/output/risk_register_diff.tsv).
- Participation: [ledger](volunteer_hours_reconciliation/output/hours_ledger.tsv), [rollup](volunteer_hours_reconciliation/output/funder_rollup.tsv).
- Stewardship: [memo](stewardship_structuring/output/structuring_memo.md), [asset inventory](stewardship_structuring/output/ip_transfer_inventory.tsv), [policy](stewardship_structuring/output/fund_use_policy.md), [governance](stewardship_structuring/output/governance_matrix.tsv).

These examples contain generated fictional data. The stewardship packet explicitly requires human decisions and makes no ownership transfer. All examples demonstrate the supported input contracts; they are not domain-expert-reviewed production documents. Reproduce with `wm task run <task-id>` after following the root README setup.
