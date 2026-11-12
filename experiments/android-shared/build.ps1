param(
    [string]$NodePath = 'node',
    [string]$GradlePath = '',
    [string]$SdkPath = $env:ANDROID_HOME,
    [switch]$Offline
)
$ErrorActionPreference = 'Stop'
$pilotRoot = $PSScriptRoot
$androidRoot = Join-Path $pilotRoot 'android'
if (-not $GradlePath) { $GradlePath = Join-Path $androidRoot 'gradlew.bat' }
if (-not $SdkPath) { $SdkPath = $env:ANDROID_SDK_ROOT }
if (-not $SdkPath) { throw 'Specify -SdkPath or ANDROID_HOME/ANDROID_SDK_ROOT.' }
$resolvedSdk = (Resolve-Path -LiteralPath $SdkPath).Path.Replace('\', '/')
[System.IO.File]::WriteAllText((Join-Path $androidRoot 'local.properties'), "sdk.dir=$resolvedSdk`n", [System.Text.UTF8Encoding]::new($false))
& $NodePath (Join-Path $pilotRoot 'build-web.mjs')
if ($LASTEXITCODE -ne 0) { throw 'Shared web build failed.' }
& $NodePath --test (Join-Path $pilotRoot 'shared-rules.test.mjs') (Join-Path $pilotRoot 'message-render.test.mjs') (Join-Path $pilotRoot 'chat-controls.test.mjs') (Join-Path $pilotRoot 'voice-services.test.mjs') (Join-Path $pilotRoot 'native-microphone.test.mjs') (Join-Path $pilotRoot '../../scripts/voice-services.test.mjs') (Join-Path $pilotRoot '../../scripts/voice-conversation.test.mjs') (Join-Path $pilotRoot '../../scripts/check-shared-core.test.mjs') (Join-Path $pilotRoot '../../scripts/weekend-engine.test.mjs') (Join-Path $pilotRoot '../../scripts/weekend-recommend.test.mjs') (Join-Path $pilotRoot '../../scripts/topic-plugins.test.mjs')
if ($LASTEXITCODE -ne 0) { throw 'Shared rules verification failed.' }
$gradleArguments = @('--no-daemon', '-p', $androidRoot, 'assembleDebug', 'assembleAndroidTest')
if ($Offline) { $gradleArguments += '--offline' }
& $GradlePath @gradleArguments
if ($LASTEXITCODE -ne 0) { throw 'Android build failed.' }
$artifacts = Join-Path $pilotRoot 'artifacts'
New-Item -ItemType Directory -Path $artifacts -Force | Out-Null
$pilotConfig = Get-Content -LiteralPath (Join-Path $pilotRoot 'pilot-config.json') -Raw | ConvertFrom-Json
$apk = Join-Path $artifacts ('secretary-shared-pilot-' + $pilotConfig.version + '.apk')
Copy-Item -LiteralPath (Join-Path $androidRoot 'app/build/outputs/apk/debug/app-debug.apk') -Destination $apk
Get-Item -LiteralPath $apk | Select-Object Name,Length
Get-FileHash -LiteralPath $apk -Algorithm SHA256 | Format-List Algorithm,Hash,Path
