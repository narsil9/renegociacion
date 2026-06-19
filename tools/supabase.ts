import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as fs from 'fs';

dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('❌ Error: Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env');
  process.exit(1);
}

export const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    persistSession: false,
  },
});

export interface ClientRow {
  id: string;
  rut: string;
  name: string;
  clave_unica_rut: string;
  clave_unica_password: string;
  nacionalidad: string;
  fecha_nacimiento: string;
  estado_civil: string;
  regimen_patrimonial: string | null;
  profesion_oficio: string;
  ocupacion: string;
  direccion: string;
  region: string;
  comuna: string;
  email: string;
  telefono_prefijo: string;
  telefono: string;
}

export interface AutomationJobRow {
  id: string;
  client_id: string;
  step: number;
  status: 'pending' | 'running' | 'success' | 'failed';
  error_log: string | null;
  screenshot_url: string | null;
  created_at: string;
  updated_at: string;
  clients?: ClientRow;
}

/**
 * Polls for the oldest pending job, locks it by changing status to 'running',
 * and returns the job with its associated client details.
 */
export async function getNextPendingJob(): Promise<AutomationJobRow | null> {
  // 1. Fetch the oldest pending job
  const { data, error } = await supabase
    .from('automation_jobs')
    .select('*, clients(*)')
    .eq('status', 'pending')
    .order('created_at', { ascending: true })
    .limit(1);

  if (error) {
    console.error('❌ Error polling pending jobs:', error.message);
    return null;
  }

  if (!data || data.length === 0) {
    return null;
  }

  const job = data[0] as AutomationJobRow;

  // 2. Try to lock the job by setting it to running
  const { data: updatedData, error: updateError } = await supabase
    .from('automation_jobs')
    .update({
      status: 'running',
      updated_at: new Date().toISOString(),
    })
    .eq('id', job.id)
    .eq('status', 'pending') // concurrency check
    .select('*, clients(*)');

  if (updateError) {
    console.error(`❌ Error locking job ${job.id}:`, updateError.message);
    return null;
  }

  if (!updatedData || updatedData.length === 0) {
    // Someone else locked it in the split second
    return null;
  }

  return updatedData[0] as AutomationJobRow;
}

/**
 * Updates a job status to success.
 */
export async function markJobSuccess(jobId: string): Promise<void> {
  const { error } = await supabase
    .from('automation_jobs')
    .update({
      status: 'success',
      updated_at: new Date().toISOString(),
    })
    .eq('id', jobId);

  if (error) {
    console.error(`❌ Error marking job ${jobId} as success:`, error.message);
  } else {
    console.log(`✓ Job ${jobId} marked as SUCCESS in Supabase.`);
  }
}

/**
 * Updates a job status to failed and records the error log and screenshot URL.
 */
export async function markJobFailed(
  jobId: string,
  errorLog: string,
  screenshotUrl: string | null
): Promise<void> {
  const { error } = await supabase
    .from('automation_jobs')
    .update({
      status: 'failed',
      error_log: errorLog,
      screenshot_url: screenshotUrl,
      updated_at: new Date().toISOString(),
    })
    .eq('id', jobId);

  if (error) {
    console.error(`❌ Error marking job ${jobId} as failed:`, error.message);
  } else {
    console.log(`✓ Job ${jobId} marked as FAILED in Supabase.`);
  }
}

/**
 * Uploads a local screenshot file to Supabase storage 'screenshots' bucket
 * and returns the public URL.
 */
export async function uploadScreenshot(
  filePath: string,
  jobId: string
): Promise<string | null> {
  if (!fs.existsSync(filePath)) {
    console.error(`❌ Screenshot file does not exist at: ${filePath}`);
    return null;
  }

  try {
    const fileBuffer = fs.readFileSync(filePath);
    const fileName = `failure_${jobId}_${Date.now()}.png`;

    const { data, error } = await supabase.storage
      .from('screenshots')
      .upload(fileName, fileBuffer, {
        contentType: 'image/png',
        upsert: true,
      });

    if (error) {
      console.error('❌ Error uploading screenshot to Supabase Storage:', error.message);
      return null;
    }

    // Get public URL
    const { data: publicUrlData } = supabase.storage
      .from('screenshots')
      .getPublicUrl(fileName);

    return publicUrlData.publicUrl;
  } catch (err: any) {
    console.error('❌ Exception during screenshot upload:', err.message || err);
    return null;
  }
}
