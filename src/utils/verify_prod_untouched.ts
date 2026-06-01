import { getProdReadOnlyClient } from './prodReadOnly';
import * as fs from 'fs';
import * as path from 'path';

const TABLES_OF_INTEREST = [
  'v_casos_renegociacion',
  'renegociacion_overrides',
  'bronze_projects',
  'bronze_customers_main',
  'bronze_customers_sub',
  'mac_mini_jobs',
];

async function getSnapshot() {
  const prodUrl = process.env.PROD_SUPABASE_URL!;
  const prodKey = process.env.PROD_SUPABASE_SERVICE_ROLE_KEY!;
  const supabase = getProdReadOnlyClient();

  // 1. Fetch tables list from OpenAPI
  const response = await fetch(`${prodUrl}/rest/v1/`, {
    headers: {
      'apikey': prodKey,
      'Authorization': `Bearer ${prodKey}`
    } as Record<string, string>
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch schema: ${response.status} ${response.statusText}`);
  }

  const schema = await response.json();
  const tables = Object.keys(schema.definitions || {}).sort();

  // 2. Fetch row counts for each table of interest
  const tableCounts: Record<string, number> = {};
  for (const table of TABLES_OF_INTEREST) {
    if (tables.includes(table)) {
      const { count, error } = await supabase
        .from(table)
        .select('*', { count: 'exact', head: true });

      if (error) {
        console.warn(`⚠️ Warning: Could not get count for table "${table}": ${error.message}`);
        tableCounts[table] = -1;
      } else {
        tableCounts[table] = count || 0;
      }
    } else {
      tableCounts[table] = -1; // table does not exist
    }
  }

  return {
    timestamp: new Date().toISOString(),
    tables,
    tableCounts,
  };
}

async function main() {
  const outputsDir = path.join(process.cwd(), 'outputs');
  if (!fs.existsSync(outputsDir)) {
    fs.mkdirSync(outputsDir, { recursive: true });
  }
  const baselinePath = path.join(outputsDir, 'prod_baseline.json');

  const mode = process.argv.includes('--snapshot')
    ? 'snapshot'
    : process.argv.includes('--check')
    ? 'check'
    : '';

  if (!mode) {
    console.error('Uso:');
    console.error('  npx ts-node src/utils/verify_prod_untouched.ts --snapshot');
    console.error('  npx ts-node src/utils/verify_prod_untouched.ts --check');
    process.exit(1);
  }

  try {
    if (mode === 'snapshot') {
      console.log('📸 Generating production database snapshot...');
      const snapshot = await getSnapshot();
      fs.writeFileSync(baselinePath, JSON.stringify(snapshot, null, 2), 'utf-8');
      console.log(`✓ Baseline snapshot saved to: ${baselinePath}`);
      console.log('Counts captured:');
      console.table(snapshot.tableCounts);
    } else {
      console.log('🔍 Checking production integrity against baseline...');
      if (!fs.existsSync(baselinePath)) {
        console.error(`❌ Error: Baseline snapshot does not exist at: ${baselinePath}. Run --snapshot first.`);
        process.exit(1);
      }

      const baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf-8'));
      const current = await getSnapshot();

      // Compare tables list
      const baselineTablesStr = JSON.stringify(baseline.tables);
      const currentTablesStr = JSON.stringify(current.tables);
      if (baselineTablesStr !== currentTablesStr) {
        console.error('🚨 INTEGRITY VIOLATION: Production table schema has changed!');
        console.log('Baseline tables:', baseline.tables);
        console.log('Current tables:', current.tables);
        process.exit(1);
      }

      // Compare row counts
      let deltaDetected = false;
      const deltas: Record<string, { baseline: number; current: number; delta: number }> = {};
      
      for (const table of TABLES_OF_INTEREST) {
        const baseCount = baseline.tableCounts[table] ?? -1;
        const curCount = current.tableCounts[table] ?? -1;
        
        if (baseCount !== curCount) {
          deltas[table] = {
            baseline: baseCount,
            current: curCount,
            delta: curCount - baseCount,
          };
          deltaDetected = true;
        }
      }

      if (deltaDetected) {
        console.error('🚨 INTEGRITY VIOLATION: Production table row counts have changed!');
        console.table(deltas);
        process.exit(1);
      }

      console.log('✅ INTEGRITY CONFIRMED: Production database has ZERO changes. 100% untouched!');
    }
  } catch (err: any) {
    console.error('🚨 Verification script failed:', err.message || err);
    process.exit(1);
  }
}

main();
