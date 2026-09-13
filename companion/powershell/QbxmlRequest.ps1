#requires -version 3
<#
    ACE Export Helper - QuickBooks Desktop request bridge.

    Sends one qbXML request to the locally installed QuickBooks Desktop through
    the SDK's COM request processor, and writes the response to a file.

    Why PowerShell rather than a native Node addon: QBXMLRP2.RequestProcessor is
    a 32-bit in-process COM server. A 64-bit process cannot create it, and
    shipping a native binding would put a compiler in the install path. Spawning
    the 32-bit Windows PowerShell keeps the install to "unzip and run".

    Nothing is interpolated into code here. Every value arrives as a parameter
    and the request body is read from a file, so no invoice content can become
    a command.

    Parameters are passed by the caller (companion/src/transport/ComTransport.ts).
#>
param(
    [Parameter(Mandatory = $true)][string] $RequestPath,
    [Parameter(Mandatory = $true)][string] $ResponsePath,
    [Parameter(Mandatory = $true)][string] $AppName,
    [string] $AppId = '',
    # Empty means "the company file that is open in QuickBooks right now".
    [string] $CompanyFile = '',
    # QBXMLRPConnectionType: 1 = localQBD, 3 = localQBDLaunchUI (starts
    # QuickBooks if it is closed; the user must still be signed in).
    [int] $ConnectionType = 1,
    # QBFileMode: 2 = qbFileOpenDoNotCare.
    [int] $FileMode = 2
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'

$processor = $null
$ticket = $null
$exitCode = 0

try {
    if (-not (Test-Path -LiteralPath $RequestPath)) {
        throw "Request file not found: $RequestPath"
    }
    $request = [System.IO.File]::ReadAllText($RequestPath, [System.Text.Encoding]::UTF8)

    try {
        $processor = New-Object -ComObject QBXMLRP2.RequestProcessor
    }
    catch {
        throw ("Could not create QBXMLRP2.RequestProcessor. Install the QuickBooks Desktop SDK, " +
               "and make sure this script is running under 32-bit PowerShell " +
               "(C:\Windows\SysWOW64\WindowsPowerShell\v1.0\powershell.exe). Original error: " +
               $_.Exception.Message)
    }

    $processor.OpenConnection2($AppId, $AppName, $ConnectionType)
    $ticket = $processor.BeginSession($CompanyFile, $FileMode)
    $response = $processor.ProcessRequest($ticket, $request)

    $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText($ResponsePath, $response, $utf8NoBom)
}
catch {
    [Console]::Error.WriteLine($_.Exception.Message)
    $exitCode = 1
}
finally {
    if ($null -ne $ticket) {
        try { $processor.EndSession($ticket) } catch { }
    }
    if ($null -ne $processor) {
        try { $processor.CloseConnection() } catch { }
        try { [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($processor) } catch { }
    }
}

exit $exitCode
