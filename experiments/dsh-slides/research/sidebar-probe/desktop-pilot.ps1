param(
  [Parameter(Mandatory = $true)]
  [ValidateSet('Install', 'Run', 'Restore')]
  [string]$Action,
  [switch]$Hidden,
  [ValidateRange(0, 65535)][int]$DebugPort = 0
)

$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '../../../..')).Path
$artifacts = Join-Path $root 'experiments/android-shared/artifacts'
$pilotHome = Join-Path $artifacts 'dsh-desktop-isolated-home'
$pilotAgents = Join-Path $artifacts 'dsh-desktop-isolated-agents'
$electronData = Join-Path $artifacts 'dsh-desktop-isolated-electron'
$marker = Join-Path $pilotHome '.secretary-desktop-pilot'
$profileDir = Join-Path $pilotHome 'profiles/desktop'
$profile = Join-Path $profileDir 'package.json'
$workspaceRoot = Join-Path $pilotHome 'workspace-root'
$sidebarPackage = Join-Path $artifacts 'dsh-sidebar-desktop-custom-rc2'
$slidesDir = Join-Path $root 'experiments/dsh-slides'
$installDir = Join-Path $env:LOCALAPPDATA 'Programs/DeepSeek Harness'
$asar = Join-Path $installDir 'resources/app.asar'
$dsh = Join-Path $installDir 'resources/runtime/cli/bin/dsh.cmd'
$desktop = Join-Path $installDir 'DeepSeek Harness.exe'
$builder = Join-Path $PSScriptRoot 'build-isolated.mjs'
$utf8 = New-Object System.Text.UTF8Encoding($false)

if (-not (Test-Path -LiteralPath $dsh -PathType Leaf) -or -not (Test-Path -LiteralPath $desktop -PathType Leaf)) { throw '未找到 DSH 桌面运行时。' }
if ($Action -eq 'Install') {
  if (-not (Test-Path -LiteralPath $marker -PathType Leaf)) {
    if ((Test-Path -LiteralPath $pilotHome) -or (Test-Path -LiteralPath $pilotAgents) -or (Test-Path -LiteralPath $electronData)) { throw '试验目录已存在但没有标记，拒绝操作。' }
    New-Item -ItemType Directory -Force -Path $pilotHome | Out-Null
    [IO.File]::WriteAllText($marker, 'personal-ai-secretary isolated desktop pilot', $utf8)
  }
} elseif (-not (Test-Path -LiteralPath $marker -PathType Leaf)) { throw '未找到专用桌面试验配置；请先执行 Install。' }

try { $pilotLock = [IO.File]::Open((Join-Path $pilotHome '.pilot.lock'), [IO.FileMode]::OpenOrCreate, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None) }
catch { throw '桌面试验正在运行或被其他操作占用，请先完全退出。' }
$previousHome = [Environment]::GetEnvironmentVariable('DSH_HOME', 'Process')
$previousAgents = [Environment]::GetEnvironmentVariable('AGENTS_HOME', 'Process')
try {
  # The packaged application uses a single-instance lock. Refuse rather than
  # allow a launch to be redirected to another DSH desktop process.
  $otherDesktop = @(Get-CimInstance Win32_Process -Filter "Name = 'DeepSeek Harness.exe'" | Where-Object {
    -not $_.CommandLine -or ($_.CommandLine -notmatch '--type=' -and $_.CommandLine -notmatch '--expose-internals')
  })
  if ($otherDesktop.Count -gt 0) { throw '检测到 DSH 桌面程序仍在运行。请先完全退出它（包括托盘），再启动或修改试验。' }
  $env:DSH_HOME = $pilotHome
  $env:AGENTS_HOME = $pilotAgents
  if ($Action -eq 'Install') {
    & node $builder $asar --desktop
    if ($LASTEXITCODE -ne 0) { throw 'DSH 版本校验或试验侧栏构建失败。' }
    & npm pack $slidesDir --pack-destination $artifacts
    if ($LASTEXITCODE -ne 0) { throw '幻灯片插件打包失败。' }
    $version = (Get-Content -Raw -Encoding UTF8 (Join-Path $slidesDir 'package.json') | ConvertFrom-Json).version
    $slidesPackage = Join-Path $artifacts "dsh-secretary-slides-pilot-$version.tgz"
    if (-not (Test-Path -LiteralPath $profileDir)) {
      New-Item -ItemType Directory -Force $profileDir, $workspaceRoot | Out-Null
      $manifest = [ordered]@{ name='dsh-profile-desktop'; private=$true; dependencies=@{}; dsh=@{profile=@{bundles=@('@deepseek-ai/dsh-base','@deepseek-ai/dsh-web-app')}} }
      [IO.File]::WriteAllText($profile, ($manifest | ConvertTo-Json -Depth 10), $utf8)
      [IO.File]::WriteAllText((Join-Path $profileDir 'cordis.yml'), "[]`n", $utf8)
      [IO.File]::WriteAllText((Join-Path $profileDir 'pnpm-workspace.yaml'), "packages:`n  - .`n`nnodeLinker: hoisted`nautoInstallPeers: false`n", $utf8)
      $workspaceJson = ConvertTo-Json -InputObject $workspaceRoot -Compress
      [IO.File]::WriteAllText((Join-Path $profileDir 'cordis.patch.yml'), "- id: workspace-controller`n  config:`n    documentsDirectory: $workspaceJson`n", $utf8)
    }
    & $dsh plugin --profile desktop add $sidebarPackage
    if ($LASTEXITCODE -ne 0) { throw '安装桌面试验侧栏失败。' }
    & $dsh plugin --profile desktop add $slidesPackage
    if ($LASTEXITCODE -ne 0) { throw '安装桌面幻灯片插件失败。' }
    Write-Output '独立桌面试验已安装。'
  } elseif ($Action -eq 'Restore') {
    if (-not (Test-Path -LiteralPath $profile -PathType Leaf)) { throw '试验配置不存在。' }
    $config = Get-Content -Raw -Encoding UTF8 $profile | ConvertFrom-Json
    if ($config.dependencies.PSObject.Properties.Name -contains '@deepseek-ai/dsh-client-ui-sidebar') {
      & $dsh plugin --profile desktop remove '@deepseek-ai/dsh-client-ui-sidebar'
      if ($LASTEXITCODE -ne 0) { throw '恢复桌面默认侧栏失败。' }
    }
    $linkPath = Join-Path $profileDir 'node_modules/@deepseek-ai/dsh-client-ui-sidebar'
    if (Test-Path -LiteralPath $linkPath) {
      $link = Get-Item -LiteralPath $linkPath -Force
      $expected = [IO.Path]::GetFullPath($sidebarPackage).TrimEnd('\')
      if ($link.LinkType -ne 'Junction' -or @($link.Target).Count -ne 1 -or [IO.Path]::GetFullPath([string](@($link.Target)[0])).TrimEnd('\') -ine $expected) { throw '侧栏链接不是本试验创建的目录联接，拒绝移除。' }
      [IO.Directory]::Delete($link.FullName)
      if (Test-Path -LiteralPath $linkPath) { throw '试验侧栏链接未移除。' }
    }
    Write-Output '独立桌面配置已恢复默认侧栏；会话和作品保留。'
  } else {
    if (-not (Test-Path -LiteralPath $profile -PathType Leaf)) { throw '试验配置不存在。' }
    $config = Get-Content -Raw -Encoding UTF8 $profile | ConvertFrom-Json
    if ($config.dependencies.PSObject.Properties.Name -contains '@deepseek-ai/dsh-client-ui-sidebar') {
      & node $builder $asar --verify-only
      if ($LASTEXITCODE -ne 0) { throw 'DSH 已更新或版本不匹配，请勿运行桌面侧栏试验。' }
      $linkPath = Join-Path $profileDir 'node_modules/@deepseek-ai/dsh-client-ui-sidebar'
      $link = Get-Item -LiteralPath $linkPath -Force -ErrorAction Stop
      $expected = [IO.Path]::GetFullPath($sidebarPackage).TrimEnd('\')
      if ($link.LinkType -ne 'Junction' -or @($link.Target).Count -ne 1 -or [IO.Path]::GetFullPath([string](@($link.Target)[0])).TrimEnd('\') -ine $expected) { throw '试验侧栏链接不匹配，请重新安装试验。' }
      $build = Get-Content -Raw -Encoding UTF8 (Join-Path $sidebarPackage '.secretary-build.json') | ConvertFrom-Json
      $client = Join-Path $sidebarPackage 'lib/client.js'
      if ($build.version -ne '0.2.2-rc.2' -or (Get-FileHash -Algorithm SHA256 -LiteralPath $client).Hash -ine $build.clientSha256) { throw '试验侧栏包不完整或已变更，请重新安装试验。' }
    }
    New-Item -ItemType Directory -Force $electronData | Out-Null
    $desktopArgs = @('"--user-data-dir=' + $electronData + '"')
    if ($DebugPort -gt 0) { $desktopArgs += "--remote-debugging-port=$DebugPort"; $desktopArgs += '--remote-debugging-address=127.0.0.1' }
    $windowStyle = if ($Hidden) { 'Hidden' } else { 'Normal' }
    $process = Start-Process -FilePath $desktop -ArgumentList $desktopArgs -WindowStyle $windowStyle -PassThru
    Write-Output "独立 DSH 桌面试验已启动（进程 $($process.Id)）。关闭窗口可能会缩到托盘，请在应用或托盘菜单中完全退出。"
    $process.WaitForExit()
    if ($process.ExitCode -ne 0) { throw "桌面试验进程异常退出：$($process.ExitCode)" }
  }
} finally {
  $pilotLock.Dispose()
  [Environment]::SetEnvironmentVariable('DSH_HOME', $previousHome, 'Process')
  [Environment]::SetEnvironmentVariable('AGENTS_HOME', $previousAgents, 'Process')
}
