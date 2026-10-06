param(
    [Parameter(Mandatory = $true, Position = 0, ParameterSetName = 'Children')]
    [ValidateRange(1, 2147483647)]
    [int]$parentProcessId,
    [Parameter(Mandatory = $true, ParameterSetName = 'Listener')]
    [ValidateRange(1, 65535)]
    [int]$ListeningPort
)

try {
    if ($PSCmdlet.ParameterSetName -eq 'Listener') {
        $owners = @(Get-CimInstance -Namespace root/StandardCimv2 -ClassName MSFT_NetTCPConnection -Filter "LocalPort = $ListeningPort AND State = 2" -ErrorAction Stop |
            Where-Object { $_.LocalAddress -in @('127.0.0.1', '0.0.0.0', '::') } |
            Select-Object -ExpandProperty OwningProcess -Unique)
        ConvertTo-Json -InputObject $owners -Compress
        exit 0
    }
    $children = @(Get-CimInstance -ClassName Win32_Process -Filter "ParentProcessId = $parentProcessId" -Property ProcessId,Name,ParentProcessId -ErrorAction Stop |
        Select-Object ProcessId,Name,ParentProcessId)

    if ($children.Count -gt 0) {
        $children | ConvertTo-Json -Depth 2 -Compress
    } else {
        '[]'
    }
} catch {
    [Console]::Error.WriteLine($_.Exception.Message)
    exit 1
}
