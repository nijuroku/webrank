export default function handler(req, res) {
    res.setHeader('Cache-Control', 'no-store');
    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Método no permitido' });
    }

    const url = process.env.SUPABASE_URL;
    const anonKey = process.env.SUPABASE_ANON_KEY;
    if (!url || !anonKey) {
        return res.status(503).json({ error: 'Configura SUPABASE_URL y SUPABASE_ANON_KEY en Vercel.' });
    }

    // Esta clave pública está diseñada para llegar al navegador. RLS protege las tablas;
    // nunca se debe colocar aquí una clave service_role.
    return res.status(200).json({ url, anonKey });
}
