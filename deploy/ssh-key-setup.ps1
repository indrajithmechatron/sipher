# Sipher - one-time SSH key setup for the Pi
#
# Installs an ed25519 public key on the Pi so admin access is key-only, while
# the OS password stays valid as the physical-console fallback.
#
# Run from Windows when the Pi is on the network:
#   powershell -ExecutionPolicy Bypass -File deploy\ssh-key-setup.ps1
#   powershell -ExecutionPolicy Bypass -File deploy\ssh-key-setup.ps1 -DisablePasswordAuth
#
# The password is never stored or passed on the command line: the first ssh
# connection prompts for it once, exactly like a manual login.

param(
    [string[]]$Hosts = @("sipher.local", "192.168.1.35", "192.168.1.37"),
    [string]$User = "sipher",
    [string]$KeyPath = "$env:USERPROFILE\.ssh\id_ed25519_sipher",
    [string]$ConfigHost = "sipher",
    # Turn off password auth over SSH (password stays valid on the console).
    # Only do this after the key prompt-free login below has succeeded.
    [switch]$DisablePasswordAuth,
    # Skip rewriting ~/.ssh/config
    [switch]$NoConfig
)

$ErrorActionPreference = "Stop"

function Say($msg) { Write-Host "[ssh-setup] $msg" }

function Test-Port([string]$HostName, [int]$Port = 22) {
    try {
        $c = New-Object System.Net.Sockets.TcpClient
        $ok = $c.ConnectAsync($HostName, $Port).Wait(1500)
        $c.Close()
        return $ok
    } catch { return $false }
}

# --- 1. local key -----------------------------------------------------------
$sshKeygen = (Get-Command ssh-keygen.exe -ErrorAction SilentlyContinue).Source
if (-not $sshKeygen) {
    throw "OpenSSH client not found. Install it via Settings > Optional Features > OpenSSH Client."
}

if (-not (Test-Path $KeyPath)) {
    Say "generating ed25519 key at $KeyPath"
    & $sshKeygen -t ed25519 -a 100 -N '""' -C "sipher@$env:COMPUTERNAME" -f $KeyPath | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "ssh-keygen failed ($LASTEXITCODE)" }
} else {
    Say "reusing existing key $KeyPath"
}
$pubKey = "$KeyPath.pub"
if (-not (Test-Path $pubKey)) { throw "public key missing: $pubKey" }
Say ("public key: " + ((Get-Content $pubKey -Raw).Trim() -split ' ')[0])

# --- 2. find the Pi ---------------------------------------------------------
$target = $null
foreach ($h in $Hosts) {
    if (Test-Port $h) { $target = $h; break }
}
if (-not $target) {
    Write-Host ""
    Say "no reachable host on port 22 - tried: $($Hosts -join ', ')"
    Say "key is ready at $KeyPath; re-run this script when the Pi is up."
    exit 2
}
Say "target: $User@$target"

# --- 3. install the public key (prompts for the password once) --------------
$remote = "mkdir -p ~/.ssh && chmod 700 ~/.ssh && cat >> ~/.ssh/authorized_keys && sort -u -o ~/.ssh/authorized_keys ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys"
Say "installing key - enter the Pi password when prompted"
Get-Content $pubKey | & ssh -o PreferredAuthentications=password -o PubkeyAuthentication=no -o StrictHostKeyChecking=accept-new "$User@$target" $remote
if ($LASTEXITCODE -ne 0) { throw "key install failed (exit $LASTEXITCODE)" }

# --- 4. verify prompt-free login -------------------------------------------
Say "verifying key login"
$check = & ssh -o BatchMode=yes -o IdentitiesOnly=yes -o PasswordAuthentication=no -i $KeyPath -o StrictHostKeyChecking=accept-new "$User@$target" "echo key-ok" 2>&1
if ($LASTEXITCODE -ne 0 -or ($check -join '') -notmatch "key-ok") {
    throw "key login failed: $($check -join ' ')"
}
Say "key login OK"

# --- 5. pin the host in ~/.ssh/config --------------------------------------
if (-not $NoConfig) {
    $cfgPath = "$env:USERPROFILE\.ssh\config"
    $block = "Host $ConfigHost`r`n    HostName $target`r`n    User $User`r`n    IdentityFile $KeyPath`r`n    IdentitiesOnly yes`r`n    StrictHostKeyChecking accept-new"
    $old = if (Test-Path $cfgPath) { Get-Content $cfgPath -Raw } else { "" }
    if ($old -match "(?m)^Host\s+$([regex]::Escape($ConfigHost))\s*$") {
        $pattern = "(?m)^Host\s+$([regex]::Escape($ConfigHost))\s*\r?\n(?:[ \t]+\S.*\r?\n)*"
        $new = [regex]::Replace($old, $pattern, $block + "`r`n")
        Set-Content -LiteralPath $cfgPath -Value $new.TrimEnd() -Encoding ascii
        Say "updated 'Host $ConfigHost' in $cfgPath"
    } else {
        $sep = if ($old.Trim()) { "`r`n`r`n" } else { "" }
        Set-Content -LiteralPath $cfgPath -Value ($old.TrimEnd() + $sep + $block) -Encoding ascii
        Say "added 'Host $ConfigHost' to $cfgPath"
    }
    Say "next: ssh $ConfigHost"
}

# --- 6. optional hardening --------------------------------------------------
if ($DisablePasswordAuth) {
    Say "disabling SSH password auth (console password is unaffected)"
    $harden = @'
set -e
f=/etc/ssh/sshd_config.d/99-sipher-keyonly.conf
printf '%s\n' "PasswordAuthentication no" "KbdInteractiveAuthentication no" "PubkeyAuthentication yes" | sudo tee "$f" >/dev/null
sudo sshd -t
sudo systemctl reload ssh
echo hardened
'@
    $out = & ssh -o BatchMode=yes -o IdentitiesOnly=yes -i $KeyPath "$User@$target" $harden 2>&1
    if ($LASTEXITCODE -ne 0 -or ($out -join '') -notmatch "hardened") {
        Write-Host ($out -join "`n")
        throw "hardening failed - password auth was left enabled"
    }
    Say "password auth disabled; the login password still works on the physical console"
    Say "verify: ssh -o PasswordAuthentication=yes -o PubkeyAuthentication=no $User@$target (expect a refusal)"
} else {
    Say "password auth still enabled; re-run with -DisablePasswordAuth to make SSH key-only"
}

Say "done"
