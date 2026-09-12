# 허브 실행 (Windows PowerShell). 저장소 루트에서: .\scripts\start.ps1
$ErrorActionPreference = 'Stop'
Set-Location (Join-Path $PSScriptRoot '..')
if (Test-Path .env) {
  Get-Content .env | Where-Object { $_ -match '^\s*[^#][^=]*=' } | ForEach-Object {
    $k, $v = $_ -split '=', 2
    [Environment]::SetEnvironmentVariable($k.Trim(), $v.Trim(), 'Process')
  }
}
if (-not (Get-Command pnpm -ErrorAction SilentlyContinue)) { npm i -g pnpm }
if (-not (Test-Path node_modules)) { pnpm install }
if (-not (Test-Path apps/web/dist)) { pnpm build }
pnpm --filter @claude-codex/hub start
