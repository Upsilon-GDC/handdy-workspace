param([Parameter(Mandatory=$true)][string]$Manifest)
$ErrorActionPreference = 'Stop'
$previousRunAsNode = $env:ELECTRON_RUN_AS_NODE
Remove-Item Env:\ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
$pilot = Get-Content -LiteralPath $Manifest -Raw | ConvertFrom-Json
$workspace = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$allowedRoot = Join-Path $workspace 'backend\.local-repairs\phase2-installer\'
$pilotRoot = [IO.Path]::GetFullPath($pilot.output)
$installDir = [IO.Path]::GetFullPath($pilot.installDirectory)
if (!$pilotRoot.StartsWith($allowedRoot, [StringComparison]::OrdinalIgnoreCase) -or
    !$installDir.StartsWith($pilotRoot + '\', [StringComparison]::OrdinalIgnoreCase) -or
    !$pilot.name.StartsWith('CRM Phase2 Test ')) { throw 'Installer test paths are not isolated.' }
$exe = Join-Path $installDir 'CRMPhase2Pilot.exe'
$runKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
$crmStartupBefore = (Get-ItemProperty -LiteralPath $runKey -ErrorAction SilentlyContinue).CRM
$crmElectronStartupBefore = (Get-ItemProperty -LiteralPath $runKey -ErrorAction SilentlyContinue).('electron.app.CRM')
$startupName = 'electron.app.' + $pilot.name
if ((Get-ItemProperty -LiteralPath $runKey -ErrorAction SilentlyContinue).PSObject.Properties.Name -contains $startupName) {
    throw 'The pilot startup entry already exists; refusing to overwrite it.'
}
function Run-Installer([string]$installer) {
    $process = Start-Process -FilePath $installer -ArgumentList "/S /currentuser /D=$installDir" -Wait -PassThru -WindowStyle Hidden
    if ($process.ExitCode -ne 0) { throw "Pilot installation failed: $($process.ExitCode)" }
    if (!(Test-Path -LiteralPath $exe)) { throw 'Installed pilot executable is missing.' }
}
function Run-Pilot([string]$stage) {
    $env:CRM_PILOT_STAGE = $stage
    $resultPath = Join-Path $pilotRoot "$stage.json"
    if (Test-Path -LiteralPath $resultPath) { Remove-Item -LiteralPath $resultPath }
    $process = Start-Process -FilePath $exe -WorkingDirectory (Join-Path $env:WINDIR 'System32') -Wait -PassThru -WindowStyle Hidden
    if (!(Test-Path -LiteralPath $resultPath)) { throw "Pilot stage $stage produced no result (exit $($process.ExitCode))." }
    $result = Get-Content -LiteralPath $resultPath -Raw | ConvertFrom-Json
    if ($process.ExitCode -ne 0 -or !$result.success) { throw "Pilot stage $stage failed: $($result.error)" }
    if (!$result.isPackaged -or $result.executable -ne $exe) { throw 'Test did not execute the installed packaged application.' }
    Write-Host "PASS: installed pilot $stage / version $($result.version)"
    return $result
}
try {
    Run-Installer $pilot.installers[0]
    $desktopLink = Join-Path ([Environment]::GetFolderPath('Desktop')) ($pilot.name + '.lnk')
    $startLink = Join-Path ([Environment]::GetFolderPath('Programs')) ($pilot.name + '.lnk')
    $shortcutShell = New-Object -ComObject WScript.Shell
    foreach ($link in @($desktopLink, $startLink)) {
        if (!(Test-Path -LiteralPath $link) -or $shortcutShell.CreateShortcut($link).TargetPath -ne $exe) { throw "Pilot shortcut is missing or incorrect: $link" }
    }
    $first = Run-Pilot 'first-login'
    Run-Installer $pilot.installers[1]
    $command = (Get-ItemProperty -LiteralPath $runKey).($startupName)
    if (!$command -or !$command.Contains($exe)) { throw 'Windows startup does not target the isolated installed executable.' }
    $upgraded = Run-Pilot 'upgrade-startup'
    if ($upgraded.deviceId -ne $first.deviceId) { throw 'Upgrade changed the persistent device identity.' }
    Run-Pilot 'after-logout' | Out-Null
    Run-Pilot 'offline' | Out-Null
    Run-Pilot 'expired' | Out-Null
    $summary = @{ success=$true; baseline=$first.version; candidate=$upgraded.version;
        startupCommand=$command; deviceIdentityPreserved=$true; profilePreserved=$true;
        stages=@('first-login','upgrade-startup','after-logout','offline','expired') }
    $summary | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $pilotRoot 'installer-result.json')
    Write-Output 'PASS: real NSIS install/upgrade, installed app/profile retention, real startup registration, saved-account sign-in, logout, offline recovery and expired credential handling.'
} finally {
    if ($null -ne $previousRunAsNode) { $env:ELECTRON_RUN_AS_NODE = $previousRunAsNode }
    Remove-Item Env:\CRM_PILOT_STAGE -ErrorAction SilentlyContinue
    $uninstaller = Join-Path $installDir 'Uninstall CRMPhase2Pilot.exe'
    if (Test-Path -LiteralPath $uninstaller) {
        $process = Start-Process -FilePath $uninstaller -ArgumentList '/S' -Wait -PassThru -WindowStyle Hidden
        if ($process.ExitCode -ne 0) { Write-Warning "Pilot uninstaller returned $($process.ExitCode)." }
    }
    for ($attempt = 0; $attempt -lt 100 -and (Test-Path -LiteralPath $exe); $attempt++) { Start-Sleep -Milliseconds 200 }
    # Remove only this unique pilot registration; never touch the CRM entry.
    $entry = (Get-ItemProperty -LiteralPath $runKey -ErrorAction SilentlyContinue).($startupName)
    if ($entry -and $entry.Contains($exe)) { Remove-ItemProperty -LiteralPath $runKey -Name $startupName }
    $approved = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run'
    if (Test-Path -LiteralPath $approved) { Remove-ItemProperty -LiteralPath $approved -Name $startupName -ErrorAction SilentlyContinue }
    if ((Get-ItemProperty -LiteralPath $runKey -ErrorAction SilentlyContinue).CRM -ne $crmStartupBefore) {
        throw 'The real CRM startup entry changed during the isolated test.'
    }
    if ((Get-ItemProperty -LiteralPath $runKey -ErrorAction SilentlyContinue).('electron.app.CRM') -ne $crmElectronStartupBefore) { throw 'The real Electron CRM startup entry changed.' }
    $cleanup = @{ startupRemoved= !((Get-ItemProperty -LiteralPath $runKey -ErrorAction SilentlyContinue).($startupName)); crmStartupUnchanged=$true; pilotExecutableRemoved= !(Test-Path -LiteralPath $exe) }
    $cleanup | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $pilotRoot 'cleanup.json')
    if (!$cleanup.pilotExecutableRemoved) { throw 'The isolated pilot executable was not removed by uninstall.' }
}
