# build.ps1 - end-to-end build for SpeakToSpeech.
#
# Steps:
#   1. npm run build  -> frontend/dist/
#   2. PyInstaller    -> dist/SpeakToSpeech/
#   3. Inno Setup     -> dist/SpeakToSpeech-Setup-<version>.exe   (unless -SkipInstaller)
#   4. Compress       -> dist/SpeakToSpeech-portable-<date>.zip   (unless -SkipZip)
#
# Usage:
#   .\build.ps1
#   .\build.ps1 -VenvPython "C:\my-venv\Scripts\python.exe"
#   .\build.ps1 -SkipFrontend    # if frontend/dist already built
#   .\build.ps1 -SkipInstaller   # skip the Inno Setup installer
#   .\build.ps1 -SkipZip         # skip the portable zip
#   .\build.ps1 -Clean           # nuke build/ and dist/ first
#
# Requirements:
#   - The Python venv used must have faster-whisper, ctranslate2, pywebview,
#     huggingface_hub, nvidia-cublas-cu12, nvidia-cudnn-cu12 installed.
#   - Node.js + npm on PATH.
#   - PyInstaller is installed automatically on first run.
#   - Inno Setup 6 (ISCC.exe) for the installer step (auto-detected; install via
#     `winget install JRSoftware.InnoSetup`).

param(
    [string]$VenvPython = "C:\whisper-he\Scripts\python.exe",
    [switch]$SkipFrontend,
    [switch]$SkipInstaller,
    [switch]$SkipZip,
    [switch]$Clean
)

$ErrorActionPreference = "Stop"
$ProjectRoot = $PSScriptRoot
$DistDir = Join-Path $ProjectRoot "dist"
$BuildDir = Join-Path $ProjectRoot "build"
$BundleDir = Join-Path $DistDir "SpeakToSpeech"
$ExePath = Join-Path $BundleDir "SpeakToSpeech.exe"

function Write-Step($n, $total, $text) {
    Write-Host ""
    Write-Host "[$n/$total] $text" -ForegroundColor Cyan
}

function Assert-Path($p, $what) {
    if (-not (Test-Path $p)) { throw "$what not found: $p" }
}

# Sanity
Assert-Path $VenvPython "Python interpreter"
Assert-Path (Join-Path $ProjectRoot "SpeakToSpeech.spec") "SpeakToSpeech.spec"

if ($Clean) {
    Write-Step 0 4 "Cleaning previous build artifacts..."
    if (Test-Path $BuildDir) { Remove-Item -Recurse -Force $BuildDir }
    if (Test-Path $DistDir)  { Remove-Item -Recurse -Force $DistDir  }
}

# 1. Frontend
if (-not $SkipFrontend) {
    Write-Step 1 4 "Building frontend (npm run build)..."
    Push-Location (Join-Path $ProjectRoot "frontend")
    try {
        if (-not (Test-Path "node_modules")) {
            Write-Host "  node_modules missing; running npm install..." -ForegroundColor Gray
            npm install
            if ($LASTEXITCODE -ne 0) { throw "npm install failed" }
        }
        npm run build
        if ($LASTEXITCODE -ne 0) { throw "npm run build failed" }
    } finally {
        Pop-Location
    }
} else {
    Write-Step 1 4 "Skipping frontend build (-SkipFrontend)"
    Assert-Path (Join-Path $ProjectRoot "frontend\dist\index.html") "frontend/dist/index.html"
}

# 2. PyInstaller
Write-Step 2 4 "Ensuring PyInstaller is installed..."
& $VenvPython -m pip install --quiet --upgrade "pyinstaller>=6.0"
if ($LASTEXITCODE -ne 0) { throw "Failed to install/upgrade PyInstaller" }

Write-Step 3 4 "Running PyInstaller (this takes a few minutes)..."
Push-Location $ProjectRoot
try {
    if (Test-Path $BundleDir) { Remove-Item -Recurse -Force $BundleDir }
    & $VenvPython -m PyInstaller --noconfirm SpeakToSpeech.spec
    if ($LASTEXITCODE -ne 0) { throw "PyInstaller failed" }
} finally {
    Pop-Location
}

Assert-Path $ExePath "Built EXE"

# Read the app version (single source of truth).
$VersionFile = Join-Path $ProjectRoot "backend\version.py"
$AppVersion = "0.0.0"
if (Test-Path $VersionFile) {
    $m = Select-String -Path $VersionFile -Pattern '__version__\s*=\s*"([^"]+)"'
    if ($m) { $AppVersion = $m.Matches[0].Groups[1].Value }
}
Write-Host "  App version: $AppVersion" -ForegroundColor Gray

# 3. Inno Setup installer
if (-not $SkipInstaller) {
    Write-Step 3 4 "Building installer (Inno Setup)..."
    $iscc = $null
    $isccCandidates = @(
        (Join-Path $env:LOCALAPPDATA "Programs\Inno Setup 6\ISCC.exe"),
        "C:\Program Files (x86)\Inno Setup 6\ISCC.exe",
        "C:\Program Files\Inno Setup 6\ISCC.exe"
    )
    foreach ($c in $isccCandidates) { if (Test-Path $c) { $iscc = $c; break } }
    if (-not $iscc) {
        $cmd = Get-Command ISCC.exe -ErrorAction SilentlyContinue
        if ($cmd) { $iscc = $cmd.Source }
    }
    if (-not $iscc) {
        Write-Host "  Inno Setup (ISCC.exe) not found - skipping installer." -ForegroundColor Yellow
        Write-Host "  Install via: winget install JRSoftware.InnoSetup" -ForegroundColor Yellow
    } else {
        & $iscc "/DMyAppVersion=$AppVersion" (Join-Path $ProjectRoot "installer.iss")
        if ($LASTEXITCODE -ne 0) { throw "Inno Setup failed" }
        $setupPath = Join-Path $DistDir "SpeakToSpeech-Setup-$AppVersion.exe"
        if (Test-Path $setupPath) {
            $sizeMB = [math]::Round((Get-Item $setupPath).Length / 1MB, 1)
            Write-Host "  -> $setupPath  ($sizeMB MB)" -ForegroundColor Green
        }
    }
} else {
    Write-Step 3 4 "Skipping installer (-SkipInstaller)"
}

# 4. Zip
if (-not $SkipZip) {
    Write-Step 4 4 "Creating portable ZIP..."
    $stamp = Get-Date -Format "yyyyMMdd"
    $zipPath = Join-Path $DistDir "SpeakToSpeech-portable-$stamp.zip"
    if (Test-Path $zipPath) { Remove-Item $zipPath }
    Compress-Archive -Path $BundleDir -DestinationPath $zipPath
    $sizeMB = [math]::Round((Get-Item $zipPath).Length / 1MB, 1)
    Write-Host "  -> $zipPath  ($sizeMB MB)" -ForegroundColor Green
} else {
    Write-Step 4 4 "Skipping ZIP (-SkipZip)"
}

# Summary
$bundleSizeMB = [math]::Round(((Get-ChildItem -Recurse $BundleDir | Measure-Object -Property Length -Sum).Sum) / 1MB, 1)
Write-Host ""
Write-Host "Build complete." -ForegroundColor Green
Write-Host "  Bundle dir : $BundleDir  ($bundleSizeMB MB)"
Write-Host "  Launcher   : $ExePath"
Write-Host ""
Write-Host "Test it:" -ForegroundColor Yellow
Write-Host "  & `"$ExePath`""
