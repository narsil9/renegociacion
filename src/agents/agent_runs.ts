/**
 * Data access layer for the agent_runs table.
 * All writes go to the sandbox Supabase (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY).
 */

import { SupabaseClient } from '@supabase/supabase-js';
import { AgentType, AgentRunRow } from './types';

// ---------------------------------------------------------------------------
// Write helpers
// ---------------------------------------------------------------------------

/**
 * Creates a new agent_runs row in 'pending' state.
 * Returns the new row id, or throws on error.
 */
export async function insertAgentRun(
  supabase: SupabaseClient,
  clientId: string,
  step: number,
  agentType: AgentType,
  inputHash?: string
): Promise<string> {
  const { data, error } = await supabase
    .from('agent_runs')
    .insert({
      client_id: clientId,
      step,
      agent_type: agentType,
      status: 'pending',
      input_hash: inputHash ?? null,
    })
    .select('id')
    .single();

  if (error) throw new Error(`agent_runs insert failed: ${error.message}`);
  return data.id as string;
}

/** Transitions a run from pending → running. */
export async function markRunning(
  supabase: SupabaseClient,
  runId: string
): Promise<void> {
  const { error } = await supabase
    .from('agent_runs')
    .update({ status: 'running' })
    .eq('id', runId)
    .eq('status', 'pending');

  if (error) throw new Error(`agent_runs markRunning failed: ${error.message}`);
}

/** Saves output and marks the run completed. */
export async function completeRun<T>(
  supabase: SupabaseClient,
  runId: string,
  output: T,
  needsLawyerReview = false
): Promise<void> {
  const { error } = await supabase
    .from('agent_runs')
    .update({
      status: 'completed',
      output_json: output as object,
      needs_lawyer_review: needsLawyerReview,
      completed_at: new Date().toISOString(),
    })
    .eq('id', runId);

  if (error) throw new Error(`agent_runs completeRun failed: ${error.message}`);
}

/** Marks the run failed and records error messages. */
export async function failRun(
  supabase: SupabaseClient,
  runId: string,
  errors: string[]
): Promise<void> {
  const { error } = await supabase
    .from('agent_runs')
    .update({
      status: 'failed',
      errors,
      completed_at: new Date().toISOString(),
    })
    .eq('id', runId);

  if (error) throw new Error(`agent_runs failRun failed: ${error.message}`);
}

// ---------------------------------------------------------------------------
// Read helpers
// ---------------------------------------------------------------------------

/**
 * Returns the typed output of the most recent completed run for a given client
 * and agent type, or null if none exists.
 *
 * Usage:
 *   const cmf = await getLatestOutput<CmfParseOutput>(sb, clientId, 'cmf_parser');
 */
export async function getLatestOutput<T>(
  supabase: SupabaseClient,
  clientId: string,
  agentType: AgentType
): Promise<T | null> {
  const { data, error } = await supabase
    .from('agent_runs')
    .select('output_json')
    .eq('client_id', clientId)
    .eq('agent_type', agentType)
    .eq('status', 'completed')
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  if (error) {
    if (error.code === 'PGRST116') return null; // no rows
    throw new Error(`agent_runs getLatestOutput failed: ${error.message}`);
  }

  return (data?.output_json as T) ?? null;
}

/**
 * Returns the most recent completed run row (including metadata) for a client
 * and agent type. Useful when the caller needs input_hash or needs_lawyer_review.
 */
export async function getLatestRun<T>(
  supabase: SupabaseClient,
  clientId: string,
  agentType: AgentType
): Promise<AgentRunRow<T> | null> {
  const { data, error } = await supabase
    .from('agent_runs')
    .select('*')
    .eq('client_id', clientId)
    .eq('agent_type', agentType)
    .eq('status', 'completed')
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  if (error) {
    if (error.code === 'PGRST116') return null;
    throw new Error(`agent_runs getLatestRun failed: ${error.message}`);
  }

  return data as AgentRunRow<T>;
}

/** Returns all runs for a client ordered by creation time (newest first). */
export async function getRunsByClient(
  supabase: SupabaseClient,
  clientId: string
): Promise<AgentRunRow[]> {
  const { data, error } = await supabase
    .from('agent_runs')
    .select('*')
    .eq('client_id', clientId)
    .order('created_at', { ascending: false });

  if (error) throw new Error(`agent_runs getRunsByClient failed: ${error.message}`);
  return (data ?? []) as AgentRunRow[];
}
