# dispatch-codex.ps1 - one-command implementer dispatch (docs/SUBAGENTS.md is the manual).
# Creates the task worktree, grants codex sandbox ACLs, installs deps, commits the brief,
# dispatches codex headless (stdin closed, output logged), and monitors for LIMIT-ALERT
# until the run exits. Windows PowerShell 5.1 compatible.
#
#   .\scripts\dispatch-codex.ps1 -Task M10-05                         # brief at docs/tasks/M10-05-brief.md
#   .\scripts\dispatch-codex.ps1 -Task M10-05 -ServeApp               # + copy apps/os/.env for `next dev`
#   .\scripts\dispatch-codex.ps1 -Task M10-05 -Resume                 # re-dispatch after a broken run
#
# Model policy (owner call 2026-07-11): gpt-5.5 at medium reasoning. The user-level codex
# config defaults to a heavier model/effort, so BOTH -c overrides below are load-bearing.
param(
  [Parameter(Mandatory = $true)][string]$Task,
  [string]$Brief = "",
  [string]$Model = "gpt-5.5",
  [string]$ReasoningEffort = "medium",
  # "elevated" (the user-level config default) breaks headless runs: apply_patch dies on
  # UAC (error 1223) and shell exec dies on CreateProcessAsUserW error 5
  # (openai/codex#10090). "unelevated" is the working restricted-token fallback.
  [string]$WindowsSandbox = "unelevated",
  [string]$Prompt = "",
  [switch]$ServeApp,
  [switch]$Resume,
  [switch]$DryRun
)

$ErrorActionPreference = "Stop"
$RepoRoot = Split-Path $PSScriptRoot
$Worktree = "C:\dev\companyos-$Task"
$Branch = "task/$Task"
if ($Brief -eq "") { $Brief = "docs/tasks/$Task-brief.md" }
$BriefSource = Join-Path $RepoRoot $Brief
$Log = Join-Path $env:TEMP ("codex-{0}-{1}.log" -f $Task, (Get-Date -Format "yyyyMMdd-HHmmss"))

if (-not (Test-Path $BriefSource)) { throw "Brief not found: $BriefSource - write it first (Do / Don't / Acceptance criteria + pinned paths)." }

if ($Prompt -eq "") {
  if ($Resume) {
    $Prompt = "Partial work from an earlier run exists in this worktree. Do NOT revert anything. Run git status and git diff first, then complete $Brief exactly. Do not commit. Verify with pnpm typecheck, pnpm lint, pnpm test from the repo root. Report every file changed. On limits print LIMIT-ALERT: and stop."
  } else {
    $Prompt = "Read $Brief in this worktree and implement it exactly. Do not commit. Verify with pnpm typecheck, pnpm lint, pnpm test from the repo root. Report every file changed. On limits print LIMIT-ALERT: and stop."
  }
}

Write-Host "Task:      $Task ($Branch)"
Write-Host "Worktree:  $Worktree"
Write-Host "Brief:     $Brief"
Write-Host "Model:     $Model / $ReasoningEffort"
Write-Host "Log:       $Log"
if ($DryRun) { Write-Host "Prompt:    $Prompt"; Write-Host "(dry run - nothing executed)"; exit 0 }

# 1. Worktree
$worktreeExists = Test-Path $Worktree
if ($worktreeExists -and -not $Resume) { throw "$Worktree already exists. Use -Resume to re-dispatch into it, or remove it first." }
if (-not $worktreeExists) {
  if ($Resume) { throw "-Resume given but $Worktree does not exist." }
  git -C $RepoRoot worktree add $Worktree -b $Branch main
  if ($LASTEXITCODE -ne 0) { throw "git worktree add failed (branch may already exist: git branch -D $Branch)" }
}

if (-not $Resume) {
  # 2. Codex sandbox ACLs (fresh worktrees lack them - see SUBAGENTS.md). The worktree
  # ROOT grant is load-bearing: the restricted token cannot traverse into subdirs it was
  # granted on if the root itself carries no CodexSandboxUsers ACE (2026-07-15).
  icacls $Worktree /grant "CodexSandboxUsers:(OI)(CI)(M)" /q | Out-Null
  foreach ($d in @("packages", "apps", "docs", "infra")) {
    icacls (Join-Path $Worktree $d) /grant "CodexSandboxUsers:(OI)(CI)(M)" /t /q | Out-Null
  }

  # 3. Env files (root .env for db scripts; apps/os/.env only auto-loads from there)
  if (Test-Path (Join-Path $RepoRoot ".env")) { Copy-Item (Join-Path $RepoRoot ".env") (Join-Path $Worktree ".env") }
  if ($ServeApp -and (Test-Path (Join-Path $RepoRoot "apps\os\.env"))) { Copy-Item (Join-Path $RepoRoot "apps\os\.env") (Join-Path $Worktree "apps\os\.env") }

  # 4. Install
  pnpm -C $Worktree install --prefer-offline
  if ($LASTEXITCODE -ne 0) { throw "pnpm install failed in $Worktree" }

  # 5. Make sure the brief is committed on the task branch (it may be uncommitted on main)
  $briefInWorktree = Join-Path $Worktree $Brief
  Copy-Item $BriefSource $briefInWorktree -Force
  git -C $Worktree add $Brief
  git -C $Worktree diff --cached --quiet
  if ($LASTEXITCODE -ne 0) {
    git -C $Worktree commit -m "$($Task): task brief" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>" | Out-Null
    Write-Host "Committed brief on $Branch"
  }
}

# 6. Dispatch codex headless: stdin redirected from an empty file (a hung stdin read
#    stalls the whole run), stdout+stderr to the log. `codex` on PATH is an npm shim
#    (codex.ps1/.cmd), not an exe - Start-Process needs cmd.exe to resolve it.
if ($Prompt -match '["%]') { throw 'Prompt must not contain double quotes or percent signs (cmd.exe quoting).' }
$stdinFile = Join-Path $env:TEMP "codex-empty-stdin.txt"
if (-not (Test-Path $stdinFile)) { New-Item -ItemType File -Path $stdinFile | Out-Null }
$cmdLine = "/d /c codex exec --sandbox workspace-write -c model=$Model -c model_reasoning_effort=$ReasoningEffort -c windows.sandbox=\`"$WindowsSandbox\`" -C `"$Worktree`" `"$Prompt`""
$proc = Start-Process -FilePath "$env:ComSpec" -ArgumentList $cmdLine -RedirectStandardInput $stdinFile -RedirectStandardOutput $Log -RedirectStandardError "$Log.err" -NoNewWindow -PassThru
$null = $proc.Handle  # cache the handle or ExitCode reads back empty
Write-Host "codex dispatched (pid $($proc.Id)). Monitoring for LIMIT-ALERT every 30s..."

# 7. Monitor until exit
$limitSeen = $false
while (-not $proc.HasExited) {
  Start-Sleep -Seconds 30
  if (-not $limitSeen -and (Test-Path $Log)) {
    if (Select-String -Path $Log -Pattern "^LIMIT-ALERT:|out of credits" -Quiet) {
      $limitSeen = $true
      Write-Warning "LIMIT-ALERT detected in $Log - codex is stopping on a usage limit."
    }
  }
}

Write-Host ""
Write-Host "=== codex exited (code $($proc.ExitCode)) - exit 0 is NOT proof of work ==="
if (Test-Path $Log) { Get-Content $Log -Tail 40 }
Write-Host ""
Write-Host "=== git status ($Worktree) ==="
git -C $Worktree status --short
Write-Host ""
Write-Host "=== encoding check ==="
node (Join-Path $PSScriptRoot "check-encoding.mjs") --dir $Worktree
Write-Host ""
Write-Host "Architect checklist: read the diff vs the brief | run gates yourself | Playwright anything user-visible | commit on $Branch | PR to main (owner merges)."
