# Строка состояния Claude Code на Windows + отправка лимитов в гист для «Пульта».
# Claude Code передаёт сюда JSON с полем rate_limits (five_hour и seven_day: used_percentage, resets_at).
# Скрипт печатает короткую строку состояния, а раз в 30 с (если цифры изменились) или раз в 10 мин
# в фоне обновляет файл claude-usage.json в гисте. Нужны переменные среды PULT_GIST_ID и PULT_GIST_TOKEN.
param([switch]$Push)
$ErrorActionPreference = 'SilentlyContinue'
$body = Join-Path $env:TEMP 'pult-usage-body.json'

if ($Push) {
  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
  $headers = @{ Authorization = "Bearer $env:PULT_GIST_TOKEN"; Accept = 'application/vnd.github+json'; 'User-Agent' = 'pult-usage' }
  $bytes = [IO.File]::ReadAllBytes($body)
  Invoke-RestMethod -Method Patch -Uri "https://api.github.com/gists/$env:PULT_GIST_ID" -Headers $headers -Body $bytes -ContentType 'application/json; charset=utf-8' -TimeoutSec 15 | Out-Null
  exit 0
}

$j = [Console]::In.ReadToEnd() | ConvertFrom-Json
$five = $j.rate_limits.five_hour
$week = $j.rate_limits.seven_day
$line = "$($j.model.display_name)"
if ($five) { $line += " | 5h $([math]::Round([double]$five.used_percentage))%" }
if ($week) { $line += " | 7d $([math]::Round([double]$week.used_percentage))%" }
Write-Output $line

if (-not $env:PULT_GIST_TOKEN -or -not $env:PULT_GIST_ID -or (-not $five -and -not $week)) { exit 0 }
$state = Join-Path $env:TEMP 'pult-usage-last.txt'
$key = "$($five.used_percentage)|$($five.resets_at)|$($week.used_percentage)|$($week.resets_at)"
$now = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
if (Test-Path $state) {
  $prev = (Get-Content $state -Raw).Trim().Split(';')
  $age = $now - [int64]$prev[1]
  if ($age -lt 30) { exit 0 }
  if ($prev[0] -eq $key -and $age -lt 600) { exit 0 }
}
Set-Content -Path $state -Value "$key;$now"

$usage = @{ five_hour = $five; seven_day = $week; updated_at = $now } | ConvertTo-Json -Depth 5 -Compress
$payload = @{ files = @{ 'claude-usage.json' = @{ content = $usage } } } | ConvertTo-Json -Depth 5 -Compress
[IO.File]::WriteAllText($body, $payload, (New-Object Text.UTF8Encoding $false))
Start-Process powershell -WindowStyle Hidden -ArgumentList "-NoProfile -ExecutionPolicy Bypass -File `"$PSCommandPath`" -Push"
