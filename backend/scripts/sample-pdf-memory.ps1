param([int]$TargetProcessId,[string]$OutputPath,[string]$StopPath)
$ErrorActionPreference='Stop'
for ($sample=0; $sample -lt 1000 -and -not (Test-Path -LiteralPath $StopPath); $sample++) {
 try {
  $all=@(Get-CimInstance Win32_Process -Property ProcessId,ParentProcessId,Name,WorkingSetSize)
  $family=New-Object 'System.Collections.Generic.HashSet[int]'
  [void]$family.Add($TargetProcessId)
  do { $added=$false; foreach ($item in $all) { if ($family.Contains([int]$item.ParentProcessId) -and $family.Add([int]$item.ProcessId)) {$added=$true} } } while ($added)
  $owned=@($all | Where-Object {$family.Contains([int]$_.ProcessId)} | ForEach-Object {[pscustomobject]@{pid=$_.ProcessId;parent=$_.ParentProcessId;name=$_.Name;workingSetBytes=[long]$_.WorkingSetSize}})
  [ordered]@{at=[DateTime]::UtcNow.ToString('o');workingSetBytes=($owned | Measure-Object workingSetBytes -Sum).Sum;processes=$owned} | ConvertTo-Json -Depth 4 -Compress | Add-Content -LiteralPath $OutputPath -Encoding UTF8
 } catch { [ordered]@{at=[DateTime]::UtcNow.ToString('o');unavailable='PROCESS_MEMORY_UNAVAILABLE'} | ConvertTo-Json -Compress | Add-Content -LiteralPath $OutputPath -Encoding UTF8; break }
 Start-Sleep -Milliseconds 100
}
