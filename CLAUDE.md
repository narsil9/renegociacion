# Renegociación Superintendencia - Automation Project

This repository contains the hybrid automation system for filling out the renegotiation request portal at the Superintendencia de Insolvencia y Reemprendimiento (Superir) in Chile. It is designed for lawyers working on debt/bankruptcy cases to trigger step-by-step automation fragments while maintaining human-in-the-loop validation and manual control.

## Quick Facts

- **Stack**: Node.js, TypeScript, Playwright, Supabase (Client Data & Cookie Sharing)
- **Runtime Environment**: Mac Mini (Headless Server)
- **Start Command**: `npm run dev`
- **Run Automation Command**: `npm run automate -- --rut=<RUT> --step=<STEP_NUMBER>`
- **Test Command**: `npm test`

## Key Directories

- `src/automation/` - Step-specific Playwright scripts (`step1_personal.ts`, `login.ts`, etc.)
- `src/utils/` - Utility functions (browser controllers, cookie handlers, Supabase clients)
- `src/dashboard/` - Next.js Dashboard code (if integrated into the same repo)
- `outputs/` - Screenshots of successful/failed automation steps

## Code Style & Conventions

- **TypeScript strict mode** enabled.
- **Selectors Rule**: Always prefer accessibility and text-based selectors (`getByRole`, `getByLabel`, `getByText`) over brittle CSS/XPath selectors.
- **Failures & Logs**: Playwright scripts must capture a screenshot upon failure and save the page HTML to the `outputs/` directory.
- **State Verification**: Every step script must verify it is on the correct URL/state before initiating data entry.

## The 8 Portal Steps

1. **Información Personal** (Personal Information) [Priority 1 Automation]
2. **Declaraciones** (Declarations) [Manual/Auto Hybrid]
3. **Acreedores** (Creditors & Debts) [Auto from CMF/Bank PDF data]
4. **Apoderado** (Power of Attorney/Representative) [Manual/Auto]
5. **Ingresos** (Income details)
6. **Bienes** (Assets & Properties)
7. **Propuesta** (Payment Proposal)
8. **Finalizar** (Final Review & Submission)

## Skill Activation

Before modifying or executing automation scripts, check if relevant skills apply:
- Modifying automation scripts → `renegociacion-automation` skill

## Common Commands

```bash
# Run automation for a specific step
npm run automate -- --rut=12345678-9 --step=1

# Compile TypeScript
npm run build
```
