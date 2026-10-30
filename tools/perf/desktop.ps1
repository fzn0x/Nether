<#
.SYNOPSIS
Measures the performance targets that need the desktop app's window, on
Windows: how long the app takes to open to the last note, its memory once
idle, and how soon it picks up a note another app writes.

.DESCRIPTION
Starts Nether on a vault with NETHER_TRACE set, reads the points the app
records there as it starts (Desktop.Mark), lets it idle, then sums the
private working set of its whole process tree, the app and its WebView2
processes, as Task Manager counts memory. Then it writes a note into the
vault, as another app would, and waits for the app to have it in its
index, and removes it. It exits with 1 when a target is missed.

Measure a vault the app has opened before, closed with a note open, as it
usually starts: its index kept and a note to open. -Prepare opens the vault
once and waits until every note is read, which takes minutes on 50,000
notes; open a note in it then, and close the app.

.EXAMPLE
pnpm vault:generate
pnpm --filter @nether/desktop build:app
powershell -File tools/perf/desktop.ps1 -Prepare
powershell -File tools/perf/desktop.ps1
#>
param(
  [string]$Exe = (Join-Path $PSScriptRoot "..\..\apps\desktop\build\windows-amd64\Nether.exe"),
  [string]$Vault = (Join-Path $PSScriptRoot "..\..\.vaults\reference"),
  [int]$Runs = 3,
  [int]$IdleSeconds = 60,
  [switch]$Prepare
)

$startupLimit = 1500
$memoryLimit = 300
$pickupLimit = 2000

function Start-Nether([string]$Trace) {
  $start = New-Object System.Diagnostics.ProcessStartInfo
  $start.FileName = (Resolve-Path $Exe).Path
  $start.Arguments = '"' + (Resolve-Path $Vault).Path + '"'
  $start.WorkingDirectory = Split-Path $start.FileName
  $start.UseShellExecute = $false
  $start.EnvironmentVariables["NETHER_TRACE"] = $Trace
  [Diagnostics.Process]::Start($start)
}

# The points the app has recorded, by name, in milliseconds since it
# started; each line is the name, those milliseconds and the time of day
# in milliseconds since 1970.
function Get-Marks([string]$Trace) {
  $marks = @{}
  if (Test-Path $Trace) {
    foreach ($line in Get-Content $Trace) {
      $parts = $line -split " "
      if (-not $marks.ContainsKey($parts[0])) { $marks[$parts[0]] = [int]$parts[1] }
    }
  }
  $marks
}

# The first time of day a point was recorded at or after a time, or $null.
function Get-MarkAfter([string]$Trace, [string]$Name, [long]$After) {
  if (-not (Test-Path $Trace)) { return $null }
  foreach ($line in Get-Content $Trace) {
    $parts = $line -split " "
    if ($parts[0] -eq $Name -and [long]$parts[2] -ge $After) { return [long]$parts[2] }
  }
  $null
}

# Writes a note into the vault as another app would, and returns how many
# milliseconds the app took to have it in its index; then removes it.
function Measure-Pickup([string]$Trace) {
  $note = Join-Path (Resolve-Path $Vault).Path ("Nether pickup " + [guid]::NewGuid() + ".md")
  $written = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
  [IO.File]::WriteAllText($note, "Written by another app.`n")
  try {
    $deadline = (Get-Date).AddSeconds(10)
    while ((Get-Date) -lt $deadline) {
      $applied = Get-MarkAfter $Trace "change-applied" $written
      if ($null -ne $applied) { return $applied - $written }
      Start-Sleep -Milliseconds 20
    }
    $null
  } finally {
    Remove-Item $note -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 1
  }
}

function Wait-Mark([string]$Trace, [string]$Name, [int]$Seconds) {
  $deadline = (Get-Date).AddSeconds($Seconds)
  while ((Get-Date) -lt $deadline) {
    if ((Get-Marks $Trace).ContainsKey($Name)) { return $true }
    Start-Sleep -Milliseconds 100
  }
  $false
}

function Get-Tree([int]$Id) {
  foreach ($child in @(Get-CimInstance Win32_Process -Filter "ParentProcessId=$Id")) {
    $child
    Get-Tree $child.ProcessId
  }
}

# The private working set of a process and every process under it, in MB.
function Get-PrivateMB([int]$Id) {
  $ids = @($Id) + @(Get-Tree $Id | ForEach-Object { [int]$_.ProcessId })
  $sets = Get-CimInstance Win32_PerfFormattedData_PerfProc_Process |
    Where-Object { $ids -contains [int]$_.IDProcess }
  [math]::Round(($sets | Measure-Object WorkingSetPrivate -Sum).Sum / 1MB, 1)
}

function Stop-Nether($Process, [string]$Trace) {
  Stop-Process -Id $Process.Id -Force -ErrorAction SilentlyContinue
  Remove-Item $Trace -ErrorAction SilentlyContinue
}

function New-Trace { Join-Path ([IO.Path]::GetTempPath()) ("nether-trace-" + [guid]::NewGuid() + ".txt") }

if ($Prepare) {
  $trace = New-Trace
  $app = Start-Nether $trace
  try {
    if (-not (Wait-Mark $trace "notes-read" 1800)) { Write-Error "The vault's notes were not all read in 30 minutes."; exit 1 }
    "Every note is read and kept. Open a note in the vault, close the app, then measure."
  } finally {
    Stop-Nether $app $trace
  }
  exit 0
}

$results = foreach ($run in 1..$Runs) {
  $trace = New-Trace
  $app = Start-Nether $trace
  try {
    if (-not (Wait-Mark $trace "links-loaded" 60)) { Write-Error "The vault did not open in 60 seconds."; exit 1 }
    $marks = Get-Marks $trace
    if (-not $marks.ContainsKey("note-shown")) {
      Write-Error "The vault opened to no note: open a note in it, close the app, and run this again."
      exit 1
    }
    Start-Sleep -Seconds $IdleSeconds
    $memory = Get-PrivateMB $app.Id
    $pickup = Measure-Pickup $trace
    if ($null -eq $pickup) { Write-Error "The app did not pick up a note written into the vault in 10 seconds."; exit 1 }
    "run ${run}: vault shown $($marks['vault-open']) ms, last note $($marks['note-shown']) ms, links $($marks['links-loaded']) ms; idle after $IdleSeconds s: $memory MB; a new note picked up in $pickup ms" |
      Write-Host
    [pscustomobject]@{ Note = $marks["note-shown"]; Memory = $memory; Pickup = $pickup }
  } finally {
    Stop-Nether $app $trace
  }
}

function Get-Median($Values) {
  $sorted = @($Values | Sort-Object)
  $sorted[[math]::Floor(($sorted.Count - 1) / 2)]
}

function Write-Target([string]$Name, $Value, $Limit, [string]$Unit) {
  $met = $Value -lt $Limit
  Write-Host ("{0,-6} {1}: median {2} {4} (target {3} {4})" -f ($(if ($met) { "met" } else { "missed" })), $Name, $Value, $Limit, $Unit)
  $met
}

$met = @(
  (Write-Target "Opening to the last note" (Get-Median ($results | ForEach-Object Note)) $startupLimit "ms"),
  (Write-Target "Idle memory" (Get-Median ($results | ForEach-Object Memory)) $memoryLimit "MB"),
  (Write-Target "Picking up a note another app wrote" (Get-Median ($results | ForEach-Object Pickup)) $pickupLimit "ms")
)
if ($met -contains $false) { exit 1 }
