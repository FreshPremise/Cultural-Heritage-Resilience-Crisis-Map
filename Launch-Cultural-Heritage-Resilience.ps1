$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$launcher = Join-Path $projectRoot "scripts\launch_local.py"
$python = Get-Command "py.exe" -ErrorAction SilentlyContinue

if ($python) {
  & $python.Source -3 -c "import sys; raise SystemExit(0 if sys.version_info.major == 3 else 1)"
  if ($LASTEXITCODE -eq 0) {
    & $python.Source -3 $launcher
    exit $LASTEXITCODE
  }
}

$python = Get-Command "python.exe" -ErrorAction SilentlyContinue
if ($python) {
  & $python.Source $launcher
  exit $LASTEXITCODE
}

Add-Type -AssemblyName PresentationFramework
[System.Windows.MessageBox]::Show(
  "Python could not be found. Install Python or add it to PATH, then press this shortcut again.",
  "Cultural Heritage Resilience"
) | Out-Null
exit 1
