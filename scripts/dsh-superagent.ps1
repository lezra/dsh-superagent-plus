# Starts the dsh-superagent profile on Windows.
# The POSIX scripts/dsh-superagent starts the same profile under tmux; Windows has neither tmux nor sh, so this script
# starts the web app in the foreground and points lark-cli at this deployment's bot-only configuration directory.
[CmdletBinding()]
param([switch]$NoOpen)

$ErrorActionPreference = 'Stop'
$env:LARKSUITE_CLI_CONFIG_DIR = Join-Path $env:USERPROFILE '.lark-cli-dsh-superagent'
$arguments = @('--profile', 'superagent')
if ($NoOpen) { $arguments += '--no-open' }
& dsh @arguments
exit $LASTEXITCODE
