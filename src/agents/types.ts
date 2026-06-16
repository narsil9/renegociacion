/**
 * Output interfaces for each agent in the multi-agent chain.
 * Each agent serializes its output to agent_runs.output_json (JSONB).
 * The next agent reads from there — no PDF re-parsing.
 *
 * Chain order:
 *   Step 2: tributario
 *   Step 3: cmf_parser (TS, deterministic) → centinela (Claude API#1) → mapeador (Claude API#2)
 */

// Re-exported from existing modules so callers only import from this file.
export type { CmfCreditor, CmfAnalysisResult } from '../utils/cmf_analyzer';
export type {
  ReclassifiedCreditor,
  Identified261Creditor,
  AdditionalCreditor,
  FechaClave,
} from '../utils/sentinel';
export type { AcreditacionDoc, CmfDocumentOverride } from '../automation/step3_acreedores';
export type { CognitiveAlert } from '../utils/cognitive_orchestrator';

// ---------------------------------------------------------------------------
// TributarioOutput — Step 2
// Extracts: tax category + F29 activity months + contribuciones morosas.
// Replaces: analyzeTaxCategory + detectF29ActivityLast24Months for scanned PDFs.
// ---------------------------------------------------------------------------
export interface TributarioOutput {
  categoria: 'primera' | 'segunda' | 'ninguna';
  /** Months with F29 economic activity in YYYY-MM format, e.g. ['2024-01', '2024-02']. */
  f29_meses_con_actividad: string[];
  /**
   * Properties with overdue contribuciones (Condición=AFECTO + Cuotas vencidas=SI).
   * Amount is NOT in the CT — requires a Certificado de Deuda TGR.
   * Absent / empty array → no overdue contribuciones detected.
   */
  contribuciones_deuda?: import('../utils/pdf_analyzer').ContribucionProperty[];
}

// ---------------------------------------------------------------------------
// CmfParseOutput — Step 3 (deterministic TS, no Claude)
// Extracted from informe_cmf.pdf by cmf_analyzer.ts.
// Stored in agent_runs so the Sentinel reads creditors without re-parsing the PDF.
// ---------------------------------------------------------------------------
export interface CmfParseOutput {
  creditors: import('../utils/cmf_analyzer').CmfCreditor[];
  fechaEmision: string | null;               // date on the CMF header (YYYY-MM-DD)
  cmfAgeDays: number;
  qualifying90PlusCount: number;             // products with overdue90Days > 0
  meets90DaysRequirement: boolean;           // >= 2 qualifying products
  meetsAmountRequirement: boolean;           // sum of totalCredito of qualifying >= 80 UF
  totalCreditoOf90PlusCreditors: number;
  ufValueCLP: number;
}

// ---------------------------------------------------------------------------
// CentinelaOutput — Step 3, Claude API #1
// Detects reclassified (261→260), confirmed 261, and non-CMF creditors.
// Also extracts the real monto + delinquency date per document.
// ---------------------------------------------------------------------------
export interface CentinelaOutput {
  reclassifiedCreditors: import('../utils/sentinel').ReclassifiedCreditor[];
  identified261Creditors: import('../utils/sentinel').Identified261Creditor[];
  additionalCreditors: import('../utils/sentinel').AdditionalCreditor[];
  /**
   * Per-creditor overrides for direct CMF creditors (Art. 260 lines with
   * overdue90Days > 0 in the CMF). The Sentinel extracts the real monto and
   * delinquency_start_date from each acreditación document so the Mapeador
   * can pass them to fillStep3 without re-reading PDFs.
   */
  cmfDocumentOverrides: import('../automation/step3_acreedores').CmfDocumentOverride[];
  fechasClave: import('../utils/sentinel').FechaClave[];
}

// ---------------------------------------------------------------------------
// MapeadorOutput — Step 3, Claude API #2
// Assigns which file acredits which creditor, resolves same-bank ambiguity.
// Output feeds directly into fillStep3() as acreditacionDocs.
// ---------------------------------------------------------------------------
export interface MapeadorOutput {
  mappedDocs: import('../automation/step3_acreedores').AcreditacionDoc[];
  alerts: import('../utils/cognitive_orchestrator').CognitiveAlert[];
}

// ---------------------------------------------------------------------------
// AgentType union — matches the CHECK constraint in agent_runs SQL.
// ---------------------------------------------------------------------------
export type AgentType = 'cmf_parser' | 'tributario' | 'centinela' | 'mapeador';
export type AgentStatus = 'pending' | 'running' | 'completed' | 'failed';

// Generic agent_runs row shape returned by Supabase.
export interface AgentRunRow<T = unknown> {
  id: string;
  client_id: string;
  step: number;
  agent_type: AgentType;
  status: AgentStatus;
  input_hash: string | null;
  output_json: T | null;
  errors: string[] | null;
  needs_lawyer_review: boolean;
  created_at: string;
  completed_at: string | null;
}
