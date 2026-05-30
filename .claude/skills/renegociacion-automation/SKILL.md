---
name: renegociacion-automation
description: Guidelines for developing, running, and troubleshooting Playwright automation scripts for the Superintendencia de Insolvencia y Reemprendimiento (Superir) portal.
allowed-tools: Read, Grep, Glob, Bash
---

# Superintendencia Renegotiation Automation Skill

This skill teaches Claude Code how to interact with the modular, hybrid automation scripts of the `renegociacion` project.

## Core Patterns

### 1. Step Isolation
Each of the 8 steps of the renegotiation portal must have a dedicated Playwright script in `src/automation/`:
- `login.ts`: Automates RUT + ClaveÚnica.
- `step1_personal.ts`: Fills information personal.
- `step3_acreedores.ts`: Reads CMF/tributary documents and uploads creditor lists.

### 2. Cookie Extraction (Session Bridge)
To avoid forcing lawyers to log in repeatedly:
*   Upon successful login, `login.ts` must dump cookies using `context.cookies()`.
*   Store the cookies in a secure JSON structure or database record in Supabase associated with the client's RUT.
*   The dashboard can fetch these cookies to inject them into the lawyer's browser session.

### 3. Bulletproof Selectors & Navigation
*   **Do not use coordinates or strict div paths.**
*   Always use accessibility selectors:
    ```typescript
    await page.getByLabel('Dirección').fill(clientData.address);
    await page.getByRole('button', { name: 'Guardar y Continuar' }).click();
    ```
*   **Timeouts**: Increase default timeout (e.g. 60 seconds) for ClaveÚnica transitions, as the Chilean Civil Registry servers can be slow.

## Troubleshooting & Self-Healing (On Failure)

When a script fails during execution:
1.  **Read the logs and review the screenshot** saved in the `outputs/` directory.
2.  **Inspect the DOM snapshot**: Playwright is configured to dump the page HTML on failure. Check if a selector changed or if a modal dialog (e.g., *"El deudor posee una causa vigente"*) blocked the page.
3.  **Self-Correction**:
    *   If the selector changed (e.g. the label `Dirección` was renamed to `Domicilio`), modify the script code directly to match the new selector.
    *   If the error is an unexpected pop-up, add code to catch and close the modal.
    *   Run the script again to verify the fix works.

## Example File Structure
- `src/automation/login.ts` -> Log in and extract session.
- `src/automation/step1_personal.ts` -> Complete Step 1.
- `src/index.ts` -> Executable runner.
