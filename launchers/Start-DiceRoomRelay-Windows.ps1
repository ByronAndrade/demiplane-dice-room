param(
  [string] $OriginalScriptDir = ""
)

$ErrorActionPreference = "Stop"

function Get-ProviderPath {
  param([string] $Path)

  $cleanPath = ($Path -replace "^Microsoft\.PowerShell\.Core\\FileSystem::", "").TrimEnd("\", "/")
  if ($cleanPath -match "^\\\\wsl(?:\.localhost)?\\") {
    return $cleanPath
  }

  $resolved = Resolve-Path $Path
  if ($resolved.ProviderPath) {
    return $resolved.ProviderPath
  }

  return ($resolved.Path -replace "^Microsoft\.PowerShell\.Core\\FileSystem::", "")
}

$scriptDir = if ($OriginalScriptDir) {
  $OriginalScriptDir
} elseif ($PSScriptRoot) {
  $PSScriptRoot
} else {
  Split-Path -Parent $MyInvocation.MyCommand.Path
}

$scriptDir = ($scriptDir -replace "^Microsoft\.PowerShell\.Core\\FileSystem::", "").TrimEnd("\", "/")
$repoPath = if ($scriptDir -match "^\\\\wsl(?:\.localhost)?\\") {
  Split-Path -Parent $scriptDir
} else {
  Get-ProviderPath (Join-Path $scriptDir "..")
}

function Convert-WslUncToLinuxPath {
  param([string] $Path)

  $normalized = ($Path -replace "^Microsoft\.PowerShell\.Core\\FileSystem::", "") -replace "/", "\"
  if ($normalized -notmatch "^\\\\wsl(?:\.localhost)?\\([^\\]+)\\(.+)$") {
    return $null
  }

  $distro = $Matches[1]
  $linuxPath = "/" + (($Matches[2] -replace "\\", "/"))
  return @{
    Distro = $distro
    Path = $linuxPath
  }
}

$wslPath = Convert-WslUncToLinuxPath -Path $repoPath

if ($wslPath) {
  Write-Host "Iniciando relay via WSL ($($wslPath.Distro))..."
  $escapedPath = $wslPath.Path.Replace("'", "'\''")
  wsl.exe -d $wslPath.Distro -- bash -lc "cd '$escapedPath' && npm run host:relay"
  exit $LASTEXITCODE
}

Write-Host "Iniciando relay local..."
Push-Location $repoPath
try {
  npm run host:relay
} finally {
  Pop-Location
}
