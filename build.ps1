# build.ps1 — end-to-end portable build for SpeakToSpeech.
#
# Steps:
#   1. npm run build  → frontend/dist/
#   2. PyInstaller    → dist/SpeakToSpeech/
#   3. Compress       → dist/SpeakToSpeech-portable-<date>.zip
#
# Usage:
#   .\build.ps1
#   .\build.ps1 -VenvPython "C:\my-venv\Scripts\python.exe"
#   .\build.ps1 -SkipFrontend   # if frontend/dist already built
#   .\build.ps1 -SkipZip        # skip the final zip step
#   .\build.ps1 -Clean          # nuke build/ and dist/ first
#
# Requirements:
#   - The Python venv used must have faster-whisper, ctranslate2, pywebview,
#     huggingface_hub, nvidia-cublas-cu12, nvidia-cudnn-cu12 installed.
#   - Node.js + npm on PATH.
#   - PyInstaller is installed automatically on first run.

param(
    [string]$VenvPython = "C:\whisper-he\Scripts\python.exe",
    [switch]$SkipFrontend,
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

# 3. Zip
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
