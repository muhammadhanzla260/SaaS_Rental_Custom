# Rebuild and (re)start the production server on port 3000, detached from the terminal.
#   powershell -File apps/web/scripts/serve.ps1            build + start
#   powershell -File apps/web/scripts/serve.ps1 -NoBuild   restart only
param([switch]$NoBuild)
$ErrorActionPreference = 'Stop'
$web = Split-Path -Parent $PSScriptRoot
Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }
Set-Location $web
if (-not $NoBuild) {
  $out = npx next build 2>&1
  if ($LASTEXITCODE -ne 0) { $out | Select-Object -Last 40; exit 1 }
  $out | Select-String -Pattern 'Compiled' | Select-Object -First 1
}
$log = Join-Path $web '../../.data/web-server.log'
Start-Process -FilePath 'cmd.exe' -ArgumentList '/c', "npx next start --port 3000 > `"$log`" 2>&1" -WorkingDirectory $web -WindowStyle Hidden

# Background worker (scheduled emails/texts, retries, digests): restart it too.
$workerDir = Join-Path $web '../worker'
$pidFile = Join-Path $web '../../.data/worker.pid'
if (Test-Path $pidFile) { Stop-Process -Id (Get-Content $pidFile) -Force -ErrorAction SilentlyContinue }
Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" | Where-Object { $_.CommandLine -like '*worker*src*index.ts*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
$wlog = Join-Path $web '../../.data/worker.log'
$w = Start-Process -FilePath 'cmd.exe' -ArgumentList '/c', "npx tsx src/index.ts > `"$wlog`" 2>&1" -WorkingDirectory $workerDir -WindowStyle Hidden -PassThru
Set-Content -Path $pidFile -Value $w.Id
for ($i = 0; $i -lt 40; $i++) {
  Start-Sleep -Milliseconds 500
  try { if ((Invoke-WebRequest -Uri 'http://localhost:3000/sign-in' -UseBasicParsing -TimeoutSec 2).StatusCode -eq 200) { 'Server ready on http://localhost:3000'; exit 0 } } catch {}
}
'Server did not start; see .data/web-server.log'
exit 1
