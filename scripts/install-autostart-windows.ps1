# 로그온 시 허브를 자동으로 띄우는 작업 스케줄러 항목 등록 (Windows).
# 관리자 권한 없이도 현재 사용자 로그온 트리거로 등록된다.
#   .\scripts\install-autostart-windows.ps1          # 등록
#   .\scripts\install-autostart-windows.ps1 -Remove  # 해제
param([switch]$Remove)
$ErrorActionPreference = 'Stop'
$name = 'ClaudeCodexHub'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
if ($Remove) { Unregister-ScheduledTask -TaskName $name -Confirm:$false; Write-Host "removed $name"; exit }
$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$root\scripts\start.ps1`"" -WorkingDirectory $root
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$settings = New-ScheduledTaskSettingsSet -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero) -StartWhenAvailable
Register-ScheduledTask -TaskName $name -Action $action -Trigger $trigger -Settings $settings -Force | Out-Null
Start-ScheduledTask -TaskName $name
Write-Host "registered $name (runs $root\scripts\start.ps1 at logon). 로그: 작업 스케줄러 > $name"
