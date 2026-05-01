!macro customInit
  ; Check if IKANDY is running
  nsExec::ExecToStack 'tasklist /FI "IMAGENAME eq IKANDY.exe" /FO CSV /NH'
  Pop $0   ; exit code
  Pop $1   ; output
  ${If} $1 != ""
    StrCpy $2 "$1" 8
    ${If} $2 == '"IKANDY.'
      MessageBox MB_OK|MB_ICONINFORMATION "IKANDY is currently running and will be closed to apply the update.$\r$\n$\r$\nClick OK to continue."
      nsExec::Exec 'taskkill /F /IM "IKANDY.exe"'
      Sleep 1500
    ${EndIf}
  ${EndIf}
!macroend
