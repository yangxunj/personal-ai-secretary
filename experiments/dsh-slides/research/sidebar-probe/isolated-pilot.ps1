param(
  [Parameter(Mandatory = $true)]
  [ValidateSet('Install', 'Run', 'Restore')]
  [string]$Action,
  [switch]$NoOpen
)

$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '../../../..')).Path
$artifacts = Join-Path $root 'experiments/android-shared/artifacts'
$pilotHome = Join-Path $artifacts 'dsh-single-sidebar-v2-home'
$pilotAgents = Join-Path $artifacts 'dsh-single-sidebar-v2-agents'
$marker = Join-Path $pilotHome '.secretary-isolated-pilot'
$workspaceRoot = Join-Path $pilotHome 'workspace-root'
$workspacePatch = Join-Path $pilotHome 'workspace.patch.yml'
$asar = Join-Path $env:LOCALAPPDATA 'Programs/DeepSeek Harness/resources/app.asar'
$dsh = Join-Path $env:LOCALAPPDATA 'Programs/DeepSeek Harness/resources/runtime/cli/bin/dsh.cmd'
$builder = Join-Path $PSScriptRoot 'build-isolated.mjs'
$sidebarPackage = Join-Path $artifacts 'dsh-sidebar-custom-rc2'
$slidesDir = Join-Path $root 'experiments/dsh-slides'
$profile = Join-Path $pilotHome 'profiles/web/package.json'

if (-not (Test-Path -LiteralPath $dsh -PathType Leaf)) { throw '未找到 DSH 桌面版运行时。' }
if ($Action -eq 'Install') {
  if ((Test-Path -LiteralPath $pilotHome) -and -not (Test-Path -LiteralPath $marker)) {
    throw '试验目录已存在但没有标记，拒绝操作；请检查该目录。'
  }
  if ((Test-Path -LiteralPath $pilotAgents) -and -not (Test-Path -LiteralPath $marker)) {
    throw '试验智能体目录已存在但没有标记，拒绝操作；请检查该目录。'
  }
  New-Item -ItemType Directory -Force -Path $pilotHome | Out-Null
  [IO.File]::WriteAllText($marker, 'personal-ai-secretary isolated sidebar pilot')
} elseif (-not (Test-Path -LiteralPath $marker -PathType Leaf)) {
  throw '未找到专用试验配置；请先执行 Install。'
}
try {
  $pilotLock = [IO.File]::Open((Join-Path $pilotHome '.pilot.lock'), [IO.FileMode]::OpenOrCreate, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None)
} catch {
  throw '试验配置正在运行或被其他操作占用；请先停止试验后重试。'
}
if ($Action -eq 'Install') {
  & node $builder $asar
  if ($LASTEXITCODE -ne 0) { throw 'DSH 版本校验或侧栏构建失败，未更改试验配置。' }
  & npm pack $slidesDir --pack-destination $artifacts
  if ($LASTEXITCODE -ne 0) { throw '幻灯片插件打包失败，未更改试验配置。' }
  $version = (Get-Content -Raw -Encoding UTF8 (Join-Path $slidesDir 'package.json') | ConvertFrom-Json).version
  $slidesPackage = Join-Path $artifacts "dsh-secretary-slides-pilot-$version.tgz"
  New-Item -ItemType Directory -Force -Path $workspaceRoot | Out-Null
  $workspaceJson = ConvertTo-Json -InputObject $workspaceRoot -Compress
  [IO.File]::WriteAllText($workspacePatch, "- id: workspace-controller`n  config:`n    documentsDirectory: $workspaceJson`n", (New-Object System.Text.UTF8Encoding($false)))
}

$previousHome = [Environment]::GetEnvironmentVariable('DSH_HOME', 'Process')
$previousAgents = [Environment]::GetEnvironmentVariable('AGENTS_HOME', 'Process')
try {
  $env:DSH_HOME = $pilotHome
  $env:AGENTS_HOME = $pilotAgents
  if ($Action -eq 'Install') {
    & $dsh plugin --profile web add $sidebarPackage
    if ($LASTEXITCODE -ne 0) { throw '安装试验侧栏失败。' }
    & $dsh plugin --profile web add $slidesPackage
    if ($LASTEXITCODE -ne 0) { throw '安装试验幻灯片插件失败。' }
    Write-Output '独立试验配置已安装；运行 Run 启动。试验数据与日常 DSH 分开。'
  } elseif ($Action -eq 'Restore') {
    if (-not (Test-Path -LiteralPath $profile -PathType Leaf)) { throw '试验配置不存在。' }
    $config = Get-Content -Raw -Encoding UTF8 $profile | ConvertFrom-Json
    if ($config.dependencies.PSObject.Properties.Name -contains '@deepseek-ai/dsh-client-ui-sidebar') {
      & $dsh plugin --profile web remove '@deepseek-ai/dsh-client-ui-sidebar'
      if ($LASTEXITCODE -ne 0) { throw '恢复默认侧栏失败。' }
    }
    # pnpm may leave a direct-link junction after removing its manifest entry.
    # Remove only our exact junction, never its target or an unexpected path.
    $linkPath = Join-Path $pilotHome 'profiles/web/node_modules/@deepseek-ai/dsh-client-ui-sidebar'
    if (Test-Path -LiteralPath $linkPath) {
      $link = Get-Item -LiteralPath $linkPath -Force
      $expected = [IO.Path]::GetFullPath($sidebarPackage).TrimEnd('\')
      if ($link.LinkType -ne 'Junction' -or @($link.Target).Count -ne 1 -or
          [IO.Path]::GetFullPath([string](@($link.Target)[0])).TrimEnd('\') -ine $expected) {
        throw '侧栏链接不是本试验创建的目录联接，拒绝移除。'
      }
      [IO.Directory]::Delete($link.FullName)
      if (Test-Path -LiteralPath $linkPath) { throw '试验侧栏链接未移除。' }
    }
    Write-Output '独立配置已恢复默认侧栏；试验作品和会话数据保留。'
  } else {
    if (-not (Test-Path -LiteralPath $profile -PathType Leaf)) { throw '试验配置不存在。' }
    if (-not (Test-Path -LiteralPath $workspacePatch -PathType Leaf)) { throw '隔离工作区配置不存在。' }
    $config = Get-Content -Raw -Encoding UTF8 $profile | ConvertFrom-Json
    if ($config.dependencies.PSObject.Properties.Name -contains '@deepseek-ai/dsh-client-ui-sidebar') {
      & node $builder $asar --verify-only
      if ($LASTEXITCODE -ne 0) { throw 'DSH 已更新或版本不匹配；请勿运行侧栏试验。' }
    }
    Write-Output '正在启动独立 DSH Web 试验；关闭此窗口可停止服务。'
    $webArgs = @('--profile', 'web', '--patch', $workspacePatch, '--port', '0')
    if ($NoOpen) { $webArgs += '--no-open' }
    & $dsh @webArgs
    if ($LASTEXITCODE -ne 0) { throw 'DSH Web 启动失败。' }
  }
} finally {
  $pilotLock.Dispose()
  [Environment]::SetEnvironmentVariable('DSH_HOME', $previousHome, 'Process')
  [Environment]::SetEnvironmentVariable('AGENTS_HOME', $previousAgents, 'Process')
}
