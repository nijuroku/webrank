# LaMafia BEYBLADEX para Android

Aplicación Android nativa que muestra el sitio dentro de una WebView y permite importar torneos JSON desde el almacenamiento del teléfono. El acceso ya no requiere login; las tablas finalizadas se consultan y guardan en Supabase cuando está configurado.

La app abre la URL de la rama `version_b`: `https://lamafia-git-versionb-njrk.vercel.app/`. Vercel actualiza el alias de rama con la última deployment de esa rama. Si falla, la app cambia automáticamente al respaldo `https://lamafia-kappa.vercel.app/`. Ambos dominios permanecen dentro de la app.

## Crear el APK debug

Requisitos: JDK 17, Android SDK Platform 35, Android SDK Build-Tools 35.0.0 y Gradle 8.7 o superior compatible con Android Gradle Plugin 8.6.1.

Desde esta carpeta, ejecuta:

```powershell
gradle assembleDebug
```

El APK queda en:

```text
app/build/outputs/apk/debug/app-debug.apk
```

La primera compilación necesita conexión a internet para descargar Gradle y las dependencias de AndroidX.

## Comportamiento de la app

- Los enlaces del torneo permanecen dentro de la app.
- Enlaces externos, como Instagram, se abren con la aplicación correspondiente del teléfono.
- El botón Atrás de Android vuelve a la página anterior y después cierra la app.
- Los archivos de torneo se eligen desde el teléfono.
- Las exportaciones CSV/JSON se guardan en la carpeta Descargas.
