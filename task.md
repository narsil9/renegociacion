# Renegotiation Automation Task Tracker

## Completed Tasks
- [x] Brainstorming & Architecture definition (Next.js + Node/Playwright + Supabase cookie sharing)
- [x] Claude Code setup:
  - [x] Create [CLAUDE.md](file://./CLAUDE.md) (Project memory)
  - [x] Create [README.md](file://./README.md) (Architecture & Workflow)
  - [x] Create [.claude/settings.json](file://./.claude/settings.json) (Hooks)
  - [x] Create [.claude/skills/renegociacion-automation/SKILL.md](file://./.claude/skills/renegociacion-automation/SKILL.md) (Guidelines)
- [x] Session Priming:
  - [x] Create [/prime](file://./.claude/commands/prime.md) slash command

## Active / Pending Tasks
- [ ] **Phase 1: Project Initialization**
  - [ ] Initialize Node.js project (`package.json`, `tsconfig.json`)
  - [ ] Install dependencies (`playwright`, `dotenv`, etc.)
  - [ ] Configure `.env` file template
- [ ] **Phase 2: Step 1 Automation**
  - [ ] Implement ClaveÚnica Login and Cookie Extraction (`src/automation/login.ts`)
  - [ ] Implement Step 1 Form Filling (`src/automation/step1_personal.ts`)
  - [ ] Create the automation runner (`src/index.ts`)
- [ ] **Phase 3: Dashboard & Cookie Integration**
  - [ ] Setup Supabase client for reading client data and storing cookies
  - [ ] Implement script/mechanism to load session cookies into the browser for the lawyer
