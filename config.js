// ============================================================
// CONFIGURACIÓN - CREDENCIALES
// ============================================================

const CONFIG = {
    SUPABASE_URL: 'https://zennjnbnopkarplfvhdp.supabase.co',
    SUPABASE_ANON_KEY: 'sb_publishable_QE4g14ayHh6A1TDdidKcNQ_N6QEg8Ky',
    STORAGE_KEY: 'torneoData_v18',
    NICKNAME_KEY: 'beybladex_nickname',
    SYNC_INTERVAL: 30 // segundos
};

// Exportar para usar en otros archivos
if (typeof module !== 'undefined' && module.exports) {
    module.exports = CONFIG;
}