---
description: Update project documentation (CLAUDE.md, README.md, SKILL.md, and Walkthrough) with session progress and changes
allowed-tools: Read, Glob, Grep, Bash(git:*), Write
---

# Session Synchronization Command

This command is used at the end of a session to capture all progress, updates, and findings and document them in the project's memory.

## Instructions

1. **Analyze recent changes**:
   - Run `git status` to see modified or untracked files.
   - Run `git diff` on modified files (specifically in `src/` and `.claude/` directories) to understand the code changes implemented during the session.

2. **Locate and update key files**:
   - **`CLAUDE.md`**: Update quick facts, directory layouts, and critical rules (such as page selectors, dry-run safety overrides, and modal bypass fallback logic).
   - **`README.md`**: Update details about new scripts, architectures, or features introduced (e.g., Step 2 declarations, PDF extraction and compression engines).
   - **`.claude/skills/renegociacion-automation/SKILL.md`**: Ensure selectors, known portal blockers (like blocked modals), and solutions are documented in the skill pattern.
   - **`walkthrough.md`**: Update the validation details, logs, and screenshots of the latest successful executions.

3. **Verify documentation accuracy**:
   - Ensure all code links point to correct relative paths.
   - Verify that instructions align with the latest database state and queue names.

4. **Output a summary**:
   - List the modified documentation files.
   - Summarize the main progress documented in this session.
   - Ask the user if they want to review or commit the documentation changes.
