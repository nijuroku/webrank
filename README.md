# LaMafia BEYBLADEX

App estática para administrar torneos Beyblade, consultar perfiles y compartir rondas en vivo. Las páginas se generan con Astro; la lógica interactiva permanece en JavaScript del navegador y los datos se consultan en Supabase.

## Desarrollo local

Requisitos: Node.js 22.23.4 o posterior.

```sh
npm install
npm run dev
```

## Build y despliegue

```sh
npm run build
```

Astro genera las páginas estáticas y los recursos optimizados en `dist/`. Vercel compila el proyecto con `npm run build` y publica esa carpeta. Las funciones de `api/` y las rutas de compatibilidad definidas en `vercel.json` se mantienen.

## Estructura

- `src/pages/`: Inicio, perfil, torneo compartido y administración.
- `src/layouts/`: estructura HTML compartida y metadatos.
- `src/components/`: navegación reutilizable.
- `src/styles/` y `src/scripts/`: estilos y lógica por página, procesados durante el build.
- `api/`: funciones serverless para configuración de Supabase y torneos guardados.
- `supabase/`: esquema y migraciones de base de datos.
- `android/`: wrapper Android que continúa cargando el sitio publicado en la WebView.
