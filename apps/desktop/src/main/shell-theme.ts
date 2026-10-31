// Static application-owned initialization, confined to this child shell session.
// Do not interpolate project paths, prompts, or user-supplied command text here.
export const powershellTheme = `
try {
  Import-Module PSReadLine -ErrorAction Stop
  $syntax = Get-Command Set-PSReadLineOption -ErrorAction Stop
  if ($syntax.Parameters.ContainsKey('Colors')) {
    Set-PSReadLineOption -Colors @{Command='Cyan';Parameter='Yellow';String='Green';Variable='Magenta';Number='Red';Keyword='Magenta';Operator='White';Type='Yellow';Comment='DarkGray';Default='White';Error='Red';ContinuationPrompt='DarkGray'}
  } else {
    foreach ($entry in @{Command='Cyan';Parameter='Yellow';String='Green';Variable='Magenta';Number='Red';Keyword='Magenta';Operator='White';Type='Yellow';Comment='DarkGray'}.GetEnumerator()) {
      Set-PSReadLineOption -TokenKind $entry.Key -ForegroundColor $entry.Value
    }
  }
} catch { Write-Warning 'PowerShell syntax colors unavailable: PSReadLine is required.' }
function global:prompt {
  Write-Host ('PS ' + $executionContext.SessionState.Path.CurrentLocation) -NoNewline -ForegroundColor Cyan
  return '> '
}
`;
