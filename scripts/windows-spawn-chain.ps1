<#
Windows-only driver for the Electron -> dotnet -> (git, claude) spawn measurement.

  powershell -File scripts\windows-spawn-chain.ps1 -Action Build      build the app, the .NET probe and a packaged layout
  powershell -File scripts\windows-spawn-chain.ps1 -Action Register [-StripRuntimeBehavior]   register the packaged layout as an MSIX identity (Developer Mode, no signing); the switch drops uap10:RuntimeBehavior and uap10:TrustLevel, like the Store manifest
  powershell -File scripts\windows-spawn-chain.ps1 -Action Run -Mode msix|unpackaged [-Iterations 20] [-ClaudePrompt]
  powershell -File scripts\windows-spawn-chain.ps1 -Action Unregister

Reports land in $WorkDir\spawn-chain\report-<mode>.json.
#>
param(
    [Parameter(Mandatory)][ValidateSet('Build', 'Register', 'Run', 'Unregister')][string]$Action,
    [ValidateSet('msix', 'unpackaged')][string]$Mode = 'msix',
    [int]$Iterations = 20,
    [switch]$ClaudePrompt,
    [string]$ProbeOnly = '',
    [int]$ProbeIdleSeconds = 0,
    [int]$ProbeOptOutThrottleAt = 0,
    [string]$ProbeOptOutWhat = '',
    [switch]$ProbeCompare,
    [switch]$ShowWindow,
    [switch]$StealFocus,
    [ValidateSet('focused', 'minimized', 'hidden')][string]$WindowMode = 'focused',
    [switch]$StripRuntimeBehavior,
    [string]$LibsRoot = '',
    [string]$WorkDir = (Join-Path $env:USERPROFILE 'win_tester_logs'),
    [string]$Repo = ''
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$root = Split-Path $PSScriptRoot -Parent
$layout = Join-Path $WorkDir 'msix-layout'
$probeOut = Join-Path $WorkDir 'probe-bin'
$chainDir = Join-Path $WorkDir 'spawn-chain'
$packageName = 'HagiCodeOrg.ElectronDemo'

function Get-Pfn { (Get-AppxPackage -Name $packageName | Select-Object -First 1).PackageFamilyName }

switch ($Action) {
    'Build' {
        Push-Location $root
        try {
            npm run build:prod
            if ($LASTEXITCODE -ne 0) { throw 'build:prod failed' }
            node scripts/run-electron-forge.js --platform win32 --arch x64 --package-only
            if ($LASTEXITCODE -ne 0) { throw 'package failed' }
        } finally { Pop-Location }

        $args = @('build', (Join-Path $root 'tools\spawn-probe'), '-c', 'Release', '-o', $probeOut)
        if ($LibsRoot) { $args += "-p:HagiCodeLibsRoot=$LibsRoot" }
        dotnet @args
        if ($LASTEXITCODE -ne 0) { throw 'probe build failed' }

        $packaged = Get-ChildItem (Join-Path $root 'out') -Directory -Filter '*win32-x64*' | Select-Object -First 1
        if (-not $packaged) { throw 'no packaged win32-x64 output under out\' }
        if (Test-Path $layout) { Remove-Item $layout -Recurse -Force }
        New-Item -ItemType Directory -Path $layout | Out-Null
        Copy-Item $packaged.FullName (Join-Path $layout 'app') -Recurse
        Copy-Item (Join-Path $root '.cache\msix\Package.appxmanifest') (Join-Path $layout 'AppxManifest.xml')
        Copy-Item (Join-Path $root '.cache\msix-assets') (Join-Path $layout 'assets') -Recurse
        "layout ready: $layout (from $($packaged.FullName))"
    }
    'Register' {
        Get-AppxPackage -Name $packageName | Remove-AppxPackage
        $manifestPath = Join-Path $layout 'AppxManifest.xml'
        $manifestSource = Join-Path $root '.cache\msix\Package.appxmanifest'
        $manifest = Get-Content $manifestSource -Raw
        if ($StripRuntimeBehavior) {
            $manifest = $manifest -replace '\s+uap10:RuntimeBehavior="[^"]*"', '' -replace '\s+uap10:TrustLevel="[^"]*"', ''
        }
        [IO.File]::WriteAllText($manifestPath, $manifest, (New-Object Text.UTF8Encoding $false))
        Add-AppxPackage -Register $manifestPath
        "registered: " + (Get-AppxPackage -Name $packageName).PackageFullName
    }
    'Unregister' {
        Get-AppxPackage -Name $packageName | Remove-AppxPackage
        'unregistered'
    }
    'Run' {
        New-Item -ItemType Directory -Force -Path $chainDir | Out-Null
        $out = Join-Path $chainDir "report-$Mode.json"
        Remove-Item $out -ErrorAction SilentlyContinue
        if (-not $Repo) { $Repo = Join-Path $env:USERPROFILE 'repos\electron_demo' }
        $request = [ordered]@{
            label = $Mode
            probeDll = Join-Path $probeOut 'SpawnProbe.dll'
            dotnet = (Get-Command dotnet).Source
            gitPath = (Get-Command git.exe).Source
            claudePath = (Get-Command claude.exe).Source
            repo = $Repo
            iterations = $Iterations
            claudePrompt = [bool]$ClaudePrompt
            probeOnly = $ProbeOnly
            probeIdleSeconds = $ProbeIdleSeconds
            probeOptOutThrottleAt = $ProbeOptOutThrottleAt
            probeOptOutWhat = $ProbeOptOutWhat
            probeCompare = [bool]$ProbeCompare
            showWindow = [bool]$ShowWindow
            windowMode = $WindowMode
            outFile = $out
        }
        $json = $request | ConvertTo-Json
        [IO.File]::WriteAllText((Join-Path $chainDir 'request.json'), $json, (New-Object Text.UTF8Encoding $false))

        if ($Mode -eq 'msix') {
            Start-Process "shell:AppsFolder\$(Get-Pfn)!App"
        } else {
            Start-Process (Join-Path $layout 'app\electron-demo.exe')
        }

        if ($ShowWindow) {
            # Which process owns the foreground window a few seconds in, so a run can say whether the app really was in front.
            Add-Type -Namespace Win -Name Fg -MemberDefinition '[DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow(); [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);'
            Start-Sleep 2
            if ($StealFocus) {
                # Put another app in front of the window, as when the user works in a browser while the app runs behind it.
                $front = Start-Process notepad.exe -PassThru
                Start-Sleep 1
            }
            $fgPid = [uint32]0
            [void][Win.Fg]::GetWindowThreadProcessId([Win.Fg]::GetForegroundWindow(), [ref]$fgPid)
            $fg = Get-Process -Id $fgPid -ErrorAction SilentlyContinue
            Set-Content (Join-Path $chainDir "foreground-$Mode.txt") ("foreground process: " + $(if ($fg) { $fg.ProcessName } else { 'none' }))
        }

        $deadline = (Get-Date).AddMinutes(10)
        while (-not (Test-Path $out) -and (Get-Date) -lt $deadline) { Start-Sleep 2 }
        if ($front) { Stop-Process -Id $front.Id -ErrorAction SilentlyContinue }
        if (-not (Test-Path $out)) { throw "no report after 10 minutes: $out" }
        Start-Sleep 1
        "report: $out"
    }
}
