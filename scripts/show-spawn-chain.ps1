# Prints a spawn-chain report (Electron's own samples first, then the samples the dotnet probe took) as a table.
param([Parameter(Mandatory)][string]$Report)

$r = Get-Content $Report -Raw | ConvertFrom-Json
"label={0} packaged={1} windowsStore={2} exec={3}" -f $r.label, $r.electron.isPackaged, $r.electron.windowsStore, $r.electron.execPath
"dotnet probe package identity: " + $r.dotnetProbe.environment.packageFullName
if ($r.dotnetProbeError) { "probe error: " + $r.dotnetProbeError }
$rows = @($r.scenarios) + @($r.dotnetProbe.scenarios)
$rows | ForEach-Object { "{0,-30} n {1,3} first {2,8} med {3,8} p95 {4,8} max {5,8} {6}" -f $_.name, $_.count, $_.firstMs, $_.medianMs, $_.p95Ms, $_.maxMs, $_.error }
