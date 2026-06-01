# Renegotiation Automation Redesign Task Tracker

## Redesign Tasks
- [x] **Phase 1: Database Schema & Guards**
  - [x] Create production read-only client proxy (`src/utils/prodReadOnly.ts`)
  - [x] Create DDL guard script (`src/utils/create_sandbox_tables.ts`)
  - [x] Run DDL script to create `pato_prueba_clients` and `pato_prueba_automation_jobs` on Sandbox
  - [x] Create production integrity verification script (`src/utils/verify_prod_untouched.ts`)
  - [x] Take baseline snapshot of production database counts

- [x] **Phase 2: Synchronization Utility**
  - [x] Modify `src/utils/sync_prod_data.ts` to implement strict mapping, missing fields list, and write to `pato_prueba_clients`
  - [x] Run dry-run sync and verify mapping correctness
  - [x] Run strict sync to load the 132 verified clients into `pato_prueba_clients`

- [x] **Phase 3: Worker & Dashboard Integrations**
  - [x] Update worker (`src/worker.ts`) to support dual queue mode and JIT password fetching
  - [x] Update dashboard (`dashboard/src/App.tsx`) to support production trials view over custom tables

- [x] **Phase 4: Verification & Integrity**
  - [x] Verify execution of a job in the new queue in dry-run mode
  - [x] Run production integrity check to confirm zero deltas on prod DB
