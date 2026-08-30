// api/gists.js
// Esta función se ejecuta en el servidor de Vercel

export default async function handler(req, res) {
    // Configurar CORS para permitir solicitudes desde tu dominio
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    
    // Responder a preflight requests
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }
    
    // Solo permitir GET
    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Método no permitido' });
    }
    
    try {
        // Obtener el nombre de usuario de la URL (opcional)
        // Ejemplo: /api/gists?user=nijuroku
        const username = req.query.user || 'nijuroku';
        
        console.log(`📡 Buscando Gists de ${username}...`);
        
        // Hacer la solicitud a la API de GitHub
        const response = await fetch(`https://api.github.com/users/${username}/gists`, {
            headers: {
                'Accept': 'application/vnd.github.v3+json',
                'User-Agent': 'LaMafia-BeybladeX-App' // GitHub requiere User-Agent
            }
        });
        
        if (!response.ok) {
            throw new Error(`GitHub API error: ${response.status} ${response.statusText}`);
        }
        
        const gists = await response.json();
        console.log(`✅ Encontrados ${gists.length} gists`);
        
        // Filtrar solo los que tienen archivos .json
        const jsonGists = gists
            .filter(gist => {
                const files = Object.keys(gist.files || {});
                return files.some(file => file.endsWith('.json'));
            })
            .map(gist => {
                // Encontrar el primer archivo .json
                const jsonFile = Object.keys(gist.files).find(f => f.endsWith('.json'));
                const fileData = gist.files[jsonFile];
                
                return {
                    id: gist.id,
                    name: gist.description || jsonFile || 'Torneo sin nombre',
                    description: gist.description || '',
                    fileName: jsonFile,
                    url: gist.html_url,
                    rawUrl: fileData?.raw_url || null,
                    created: gist.created_at,
                    updated: gist.updated_at,
                    isPublic: gist.public
                };
            })
            .sort((a, b) => new Date(b.updated) - new Date(a.updated)); // Más reciente primero
        
        // Devolver los resultados
        return res.status(200).json({
            success: true,
            count: jsonGists.length,
            gists: jsonGists,
            username: username
        });
        
    } catch (error) {
        console.error('❌ Error en API de Gists:', error);
        return res.status(500).json({
            success: false,
            error: error.message,
            gists: []
        });
    }
}