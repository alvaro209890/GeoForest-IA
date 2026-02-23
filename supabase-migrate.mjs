/**
 * GeoForest-IA — Execute SQL migration via Supabase
 * Uses the sb_secret key to call the Supabase SQL endpoint.
 */

const SUPABASE_URL = "https://fgeitnqaosrpnbvxizrb.supabase.co";
const SERVICE_KEY = "sb_secret_BIX1Yt-B0-G29Q0MG1K6fw_hQAu8gxn";

// Split SQL into individual statements to execute one at a time
const statements = [
    // 1. USERS
    `CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    auth_uid TEXT UNIQUE NOT NULL,
    email TEXT NOT NULL,
    full_name TEXT NOT NULL,
    crea_number TEXT,
    specialization TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
  )`,
    `CREATE INDEX IF NOT EXISTS idx_users_auth_uid ON users(auth_uid)`,

    // 2. CONVERSATIONS
    `CREATE TABLE IF NOT EXISTS conversations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title TEXT NOT NULL DEFAULT 'Nova conversa',
    kind TEXT,
    simcar_job_id TEXT,
    auas_job_id TEXT,
    messages JSONB NOT NULL DEFAULT '[]'::jsonb,
    last_message_preview TEXT,
    last_attachment_type TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
    `CREATE INDEX IF NOT EXISTS idx_conversations_user_id ON conversations(user_id)`,
    `CREATE INDEX IF NOT EXISTS idx_conversations_updated ON conversations(user_id, updated_at DESC)`,

    // 3. SIMCAR_CLIPS
    `CREATE TABLE IF NOT EXISTS simcar_clips (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    job_id TEXT NOT NULL,
    kind TEXT NOT NULL DEFAULT 'simcar_recorte',
    title TEXT,
    filename TEXT NOT NULL,
    "timestamp" TIMESTAMPTZ,
    download_url TEXT,
    total_features INTEGER DEFAULT 0,
    property_area_ha DOUBLE PRECISION DEFAULT 0,
    layers_with_data INTEGER DEFAULT 0,
    total_layers INTEGER DEFAULT 0,
    conversation_id UUID,
    input_zip_url TEXT,
    output_zip_url TEXT,
    context_url TEXT,
    source_mode TEXT,
    files JSONB,
    analysis_images JSONB DEFAULT '[]'::jsonb,
    analysis_messages JSONB DEFAULT '[]'::jsonb,
    analysis_meta JSONB,
    analysis_message_count INTEGER DEFAULT 0,
    analysis_image_count INTEGER DEFAULT 0,
    last_message_preview TEXT,
    auas_analysis_images JSONB DEFAULT '[]'::jsonb,
    auas_analysis_messages JSONB DEFAULT '[]'::jsonb,
    auas_meta JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    geom GEOMETRY(MultiPolygon, 4674)
  )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_simcar_clips_user_job ON simcar_clips(user_id, job_id)`,
    `CREATE INDEX IF NOT EXISTS idx_simcar_clips_geom ON simcar_clips USING GIST(geom)`,

    // 4. AUAS_JOBS
    `CREATE TABLE IF NOT EXISTS auas_jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    job_id TEXT NOT NULL,
    kind TEXT NOT NULL DEFAULT 'novo_car',
    title TEXT,
    filename TEXT NOT NULL,
    input_filename TEXT,
    "timestamp" TIMESTAMPTZ,
    conversation_id UUID,
    ac_area_ha DOUBLE PRECISION DEFAULT 0,
    auas_area_ha DOUBLE PRECISION DEFAULT 0,
    avn_area_ha DOUBLE PRECISION DEFAULT 0,
    arl_area_ha DOUBLE PRECISION DEFAULT 0,
    property_area_ha DOUBLE PRECISION DEFAULT 0,
    river_buffer_ha DOUBLE PRECISION DEFAULT 0,
    auas_polygons JSONB DEFAULT '[]'::jsonb,
    download_url TEXT,
    input_zip_url TEXT,
    output_zip_url TEXT,
    context_url TEXT,
    analysis TEXT,
    images JSONB DEFAULT '[]'::jsonb,
    files JSONB,
    analysis_image_count INTEGER DEFAULT 0,
    satellites_used JSONB,
    satellites_missing JSONB,
    cloud_warnings JSONB,
    analysis_meta JSONB,
    analysis_rules_version TEXT,
    auas_opening_year INTEGER,
    auas_opening_date TEXT,
    auas_opening_source TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    geom GEOMETRY(MultiPolygon, 4674)
  )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_auas_jobs_user_job ON auas_jobs(user_id, job_id)`,
    `CREATE INDEX IF NOT EXISTS idx_auas_jobs_geom ON auas_jobs USING GIST(geom)`,

    // 5. WALLETS
    `CREATE TABLE IF NOT EXISTS wallets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    balance_brl NUMERIC(12,4) NOT NULL DEFAULT 0,
    total_topup_brl NUMERIC(12,4) NOT NULL DEFAULT 0,
    total_spent_brl NUMERIC(12,4) NOT NULL DEFAULT 0,
    version INTEGER NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,

    // 6. BILLING_LEDGER
    `CREATE TABLE IF NOT EXISTS billing_ledger (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    ledger_id TEXT NOT NULL,
    type TEXT NOT NULL,
    amount_brl NUMERIC(12,4) NOT NULL,
    balance_after_brl NUMERIC(12,4) NOT NULL,
    request_id TEXT NOT NULL,
    endpoint TEXT,
    reason TEXT,
    estimated BOOLEAN,
    usage JSONB,
    provider TEXT,
    model TEXT,
    asset_kind TEXT,
    bytes_stored BIGINT,
    kb_stored NUMERIC(14,4),
    gb_stored NUMERIC(14,10),
    billing_days INTEGER,
    usd_per_gb_month NUMERIC(10,4),
    brl_per_gb_month NUMERIC(10,4),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_ledger_user_ledger ON billing_ledger(user_id, ledger_id)`,
    `CREATE INDEX IF NOT EXISTS idx_ledger_user_created ON billing_ledger(user_id, created_at DESC)`,

    // 7. USAGE_DAILY
    `CREATE TABLE IF NOT EXISTS usage_daily (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    date DATE NOT NULL,
    total_cost_brl NUMERIC(12,4) NOT NULL DEFAULT 0,
    total_input_tokens BIGINT NOT NULL DEFAULT 0,
    total_output_tokens BIGINT NOT NULL DEFAULT 0,
    total_requests INTEGER NOT NULL DEFAULT 0,
    models JSONB DEFAULT '{}'::jsonb,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_usage_daily_user_date ON usage_daily(user_id, date)`,

    // 8. USER_SETTINGS
    `CREATE TABLE IF NOT EXISTS user_settings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    theme TEXT NOT NULL DEFAULT 'Escuro (Floresta)',
    language TEXT NOT NULL DEFAULT 'Português (BR)',
    font_size TEXT NOT NULL DEFAULT 'Padrão',
    coord_system TEXT NOT NULL DEFAULT 'SIRGAS 2000 (Brasil)',
    unit TEXT NOT NULL DEFAULT 'Hectares (ha)',
    default_layer TEXT NOT NULL DEFAULT 'Satélite (Alta Res.)',
    export_format TEXT NOT NULL DEFAULT 'KML / KMZ',
    include_metadata BOOLEAN NOT NULL DEFAULT true,
    compress_large BOOLEAN NOT NULL DEFAULT false,
    alert_processing BOOLEAN NOT NULL DEFAULT true,
    alert_new_features BOOLEAN NOT NULL DEFAULT false,
    alert_fires BOOLEAN NOT NULL DEFAULT true,
    two_factor_enabled BOOLEAN NOT NULL DEFAULT true
  )`,

    // 9. SYSTEM_CONFIG
    `CREATE TABLE IF NOT EXISTS system_config (
    key TEXT PRIMARY KEY,
    usd_brl_rate NUMERIC(10,4),
    usd_brl_source TEXT,
    margin NUMERIC(6,4),
    model_pricing_usd JSONB,
    updated_at TIMESTAMPTZ DEFAULT NOW()
  )`,
    `INSERT INTO system_config (key) VALUES ('billing_config') ON CONFLICT (key) DO NOTHING`,

    // RLS
    `ALTER TABLE users ENABLE ROW LEVEL SECURITY`,
    `ALTER TABLE conversations ENABLE ROW LEVEL SECURITY`,
    `ALTER TABLE simcar_clips ENABLE ROW LEVEL SECURITY`,
    `ALTER TABLE auas_jobs ENABLE ROW LEVEL SECURITY`,
    `ALTER TABLE wallets ENABLE ROW LEVEL SECURITY`,
    `ALTER TABLE billing_ledger ENABLE ROW LEVEL SECURITY`,
    `ALTER TABLE usage_daily ENABLE ROW LEVEL SECURITY`,
    `ALTER TABLE user_settings ENABLE ROW LEVEL SECURITY`,
];

async function runSQL(sql) {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/exec_sql`, {
        method: "POST",
        headers: {
            "apikey": SERVICE_KEY,
            "Authorization": `Bearer ${SERVICE_KEY}`,
            "Content-Type": "application/json",
            "Prefer": "return=minimal",
        },
        body: JSON.stringify({ query: sql }),
        signal: AbortSignal.timeout(15000),
    });
    return { status: res.status, text: await res.text().catch(() => "") };
}

async function main() {
    console.log("=== GeoForest-IA: Supabase Migration ===\n");

    // First test if exec_sql RPC exists
    const test = await runSQL("SELECT 1");
    if (test.status === 404) {
        // exec_sql doesn't exist; try pg_net or raw SQL
        console.log("exec_sql RPC not found. Trying direct SQL via pg_query...\n");

        // Try the new Supabase SQL API (v1 beta)
        for (let i = 0; i < statements.length; i++) {
            const sql = statements[i];
            const label = sql.trim().split('\n')[0].slice(0, 60);
            try {
                const res = await fetch(`${SUPABASE_URL}/pg/query`, {
                    method: "POST",
                    headers: {
                        "apikey": SERVICE_KEY,
                        "Authorization": `Bearer ${SERVICE_KEY}`,
                        "Content-Type": "application/json",
                    },
                    body: JSON.stringify({ query: sql }),
                    signal: AbortSignal.timeout(15000),
                });
                const status = res.status;
                const txt = await res.text().catch(() => "");
                const ok = status >= 200 && status < 300;
                console.log(`${ok ? '✅' : '❌'} [${i + 1}/${statements.length}] ${label}... (${status})`);
                if (!ok && txt) console.log(`   ${txt.slice(0, 200)}`);
            } catch (err) {
                console.log(`❌ [${i + 1}/${statements.length}] ${label}... (${err.message})`);
            }
        }
        return;
    }

    // exec_sql exists, use it
    console.log("Using exec_sql RPC...\n");
    for (let i = 0; i < statements.length; i++) {
        const sql = statements[i];
        const label = sql.trim().split('\n')[0].slice(0, 60);
        const result = await runSQL(sql);
        const ok = result.status >= 200 && result.status < 300;
        console.log(`${ok ? '✅' : '❌'} [${i + 1}/${statements.length}] ${label}... (${result.status})`);
        if (!ok && result.text) console.log(`   ${result.text.slice(0, 200)}`);
    }
}

main().catch(e => console.error("FATAL:", e.message));
