$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$candidatePorts = 8765..8770

function Test-HeritageApp {
  param([int]$Port)

  try {
    $response = Invoke-WebRequest -Uri ("http://127.0.0.1:{0}/" -f $Port) -UseBasicParsing -TimeoutSec 1
    return $response.StatusCode -eq 200 -and
      $response.Content -match "Cultural Heritage Resilience" -and
      $response.Headers["X-Content-Type-Options"] -eq "nosniff"
  } catch {
    return $false
  }
}

function Test-PortAvailable {
  param([int]$Port)

  $listener = [System.Net.Sockets.TcpListener]::new(
    [System.Net.IPAddress]::Loopback,
    $Port
  )
  try {
    $listener.Start()
    return $true
  } catch {
    return $false
  } finally {
    try { $listener.Stop() } catch {}
  }
}

$selectedPort = $null
foreach ($port in $candidatePorts) {
  if (Test-HeritageApp -Port $port) {
    $selectedPort = $port
    break
  }
}

if ($null -eq $selectedPort) {
  foreach ($port in $candidatePorts) {
    if (Test-PortAvailable -Port $port) {
      $selectedPort = $port
      break
    }
  }
}

if ($null -eq $selectedPort) {
  Add-Type -AssemblyName PresentationFramework
  [System.Windows.MessageBox]::Show(
    "Could not start Cultural Heritage Resilience because its local ports are already in use.",
    "Cultural Heritage Resilience"
  ) | Out-Null
  exit 1
}

$appUrl = "http://127.0.0.1:$selectedPort/"

if (-not (Test-HeritageApp -Port $selectedPort)) {
  $pythonCommand = Get-Command "py.exe" -ErrorAction SilentlyContinue
  $pythonArguments = @("-3")

  if (-not $pythonCommand) {
    $pythonCommand = Get-Command "python.exe" -ErrorAction SilentlyContinue
    $pythonArguments = @()
  }

  if (-not $pythonCommand) {
    Add-Type -AssemblyName PresentationFramework
    [System.Windows.MessageBox]::Show(
      "Python could not be found. Install Python or add it to PATH, then press this shortcut again.",
      "Cultural Heritage Resilience"
    ) | Out-Null
    exit 1
  }

  $serverScript = Join-Path $projectRoot "scripts\serve_local.py"
  $pythonArguments += @(
    ('"{0}"' -f $serverScript),
    [string]$selectedPort,
    "--bind",
    "127.0.0.1",
    "--directory",
    ('"{0}"' -f $projectRoot)
  )

  $serverProcess = @{
    FilePath = $pythonCommand.Source
    ArgumentList = $pythonArguments
    WorkingDirectory = $projectRoot
    WindowStyle = "Hidden"
  }
  Start-Process @serverProcess

  $started = $false
  for ($attempt = 0; $attempt -lt 40; $attempt++) {
    Start-Sleep -Milliseconds 250
    if (Test-HeritageApp -Port $selectedPort) {
      $started = $true
      break
    }
  }

  if (-not $started) {
    Add-Type -AssemblyName PresentationFramework
    [System.Windows.MessageBox]::Show(
      "The local server did not start. Please check that Python is working and try again.",
      "Cultural Heritage Resilience"
    ) | Out-Null
    exit 1
  }
}

Start-Process $appUrl
