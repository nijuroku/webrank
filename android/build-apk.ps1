param(
    [switch]$BootstrapTools
)

$ErrorActionPreference = 'Stop'
$projectRoot = $PSScriptRoot
$toolsRoot = Join-Path $projectRoot '.local-build-tools'
$sdkRoot = Join-Path $toolsRoot 'android-sdk'
$downloadsRoot = Join-Path $toolsRoot 'downloads'
$jdkRoot = Join-Path $toolsRoot 'jdk'
$gradleRoot = Join-Path $toolsRoot 'gradle-8.7'

if ($BootstrapTools) {
    New-Item -ItemType Directory -Path $downloadsRoot -Force | Out-Null
    New-Item -ItemType Directory -Path $jdkRoot -Force | Out-Null

    $jdkArchive = Join-Path $downloadsRoot 'temurin-jdk17.zip'
    $jdkMetadata = Invoke-RestMethod -Uri 'https://api.adoptium.net/v3/assets/latest/17/hotspot?architecture=x64&heap_size=normal&image_type=jdk&os=windows&page_size=1'
    $jdkPackage = $jdkMetadata[0].binary.package
    $jdkArchiveValid = (Test-Path $jdkArchive) -and ((Get-FileHash -Path $jdkArchive -Algorithm SHA256).Hash.ToLowerInvariant() -eq $jdkPackage.checksum.ToLowerInvariant())
    if (-not $jdkArchiveValid) {
        Invoke-WebRequest -Uri $jdkPackage.link -OutFile $jdkArchive
    }
    if ((Get-FileHash -Path $jdkArchive -Algorithm SHA256).Hash.ToLowerInvariant() -ne $jdkPackage.checksum.ToLowerInvariant()) {
        throw 'La verificación SHA-256 del JDK no coincide.'
    }
    if (-not (Get-ChildItem -Path $jdkRoot -Directory -ErrorAction SilentlyContinue)) {
        Expand-Archive -Path $jdkArchive -DestinationPath $jdkRoot -Force
    }
    $javaHome = (Get-ChildItem -Path $jdkRoot -Directory | Select-Object -First 1).FullName

    $androidToolsArchive = Join-Path $downloadsRoot 'android-command-line-tools.zip'
    $androidToolsHashExpected = '90ae805d20434428bffcb699c290860f19bb5f66a67e6b330067e3de801fb04a'
    $androidToolsValid = (Test-Path $androidToolsArchive) -and ((Get-FileHash -Path $androidToolsArchive -Algorithm SHA256).Hash.ToLowerInvariant() -eq $androidToolsHashExpected)
    if (-not $androidToolsValid) {
        Invoke-WebRequest -Uri 'https://dl.google.com/android/repository/commandlinetools-win-15859902_latest.zip' -OutFile $androidToolsArchive
    }
    $androidToolsHash = (Get-FileHash -Path $androidToolsArchive -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($androidToolsHash -ne $androidToolsHashExpected) {
        throw 'La verificación SHA-256 de Android Command Line Tools no coincide.'
    }
    $androidToolsUnpack = Join-Path $downloadsRoot 'android-tools-unpacked'
    $sdkCommandLineRoot = Join-Path $sdkRoot 'cmdline-tools'
    New-Item -ItemType Directory -Path $sdkCommandLineRoot -Force | Out-Null
    if (-not (Test-Path (Join-Path $sdkCommandLineRoot 'latest\bin\sdkmanager.bat'))) {
        Expand-Archive -Path $androidToolsArchive -DestinationPath $androidToolsUnpack -Force
        Move-Item -Path (Join-Path $androidToolsUnpack 'cmdline-tools') -Destination (Join-Path $sdkCommandLineRoot 'latest') -Force
    }

    $gradleArchive = Join-Path $downloadsRoot 'gradle-8.7-bin.zip'
    $gradleChecksum = '544c35d6bd849ae8a5ed0bcea39ba677dc40f49df7d1835561582da2009b961d'
    $gradleArchiveValid = (Test-Path $gradleArchive) -and ((Get-FileHash -Path $gradleArchive -Algorithm SHA256).Hash.ToLowerInvariant() -eq $gradleChecksum)
    if (-not $gradleArchiveValid) {
        Invoke-WebRequest -Uri 'https://services.gradle.org/distributions/gradle-8.7-bin.zip' -OutFile $gradleArchive
    }
    if ((Get-FileHash -Path $gradleArchive -Algorithm SHA256).Hash.ToLowerInvariant() -ne $gradleChecksum) {
        throw 'La verificación SHA-256 de Gradle no coincide.'
    }
    if (-not (Test-Path (Join-Path $gradleRoot 'bin\gradle.bat'))) {
        Expand-Archive -Path $gradleArchive -DestinationPath $toolsRoot -Force
    }
    $gradleRoot = Join-Path $toolsRoot 'gradle-8.7'

    $env:JAVA_HOME = $javaHome
    $env:ANDROID_HOME = $sdkRoot
    $env:ANDROID_SDK_ROOT = $sdkRoot
    $sdkManager = Join-Path $sdkRoot 'cmdline-tools\latest\bin\sdkmanager.bat'

    if (-not (Test-Path (Join-Path $sdkRoot 'platforms\android-35\android.jar')) -or -not (Test-Path (Join-Path $sdkRoot 'build-tools\35.0.0\aapt2.exe'))) {
        $licenseResponses = 1..30 | ForEach-Object { 'y' }
        $licenseResponses | & $sdkManager --sdk_root=$sdkRoot --licenses
        if ($LASTEXITCODE -ne 0) { throw 'No se pudieron aceptar las licencias del SDK de Android.' }

        & $sdkManager --sdk_root=$sdkRoot 'platforms;android-35' 'build-tools;35.0.0'
        if ($LASTEXITCODE -ne 0) { throw 'No se pudieron instalar los paquetes del SDK de Android.' }
    }
} else {
    $javaCommand = Get-Command java -ErrorAction SilentlyContinue
    if (-not $javaCommand) { throw 'No se encontró Java. Ejecuta build-apk.ps1 -BootstrapTools para preparar las herramientas.' }
    if (-not (Test-Path (Join-Path $gradleRoot 'bin\gradle.bat'))) {
        throw 'No se encontró Gradle 8.7. Ejecuta build-apk.ps1 -BootstrapTools para preparar las herramientas.'
    }
}

if ($BootstrapTools) {
    $env:JAVA_HOME = $javaHome
    $env:ANDROID_HOME = $sdkRoot
    $env:ANDROID_SDK_ROOT = $sdkRoot
}

Push-Location $projectRoot
try {
    & (Join-Path $gradleRoot 'bin\gradle.bat') --no-daemon assembleDebug
    if ($LASTEXITCODE -ne 0) { throw 'Falló la compilación del APK.' }
} finally {
    Pop-Location
}

$apkPath = Join-Path $projectRoot 'app\build\outputs\apk\debug\app-debug.apk'
if (-not (Test-Path $apkPath)) { throw 'La compilación terminó, pero no se encontró el APK esperado.' }
Write-Output "APK generado: $apkPath"
