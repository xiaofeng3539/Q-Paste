# Override electron-builder's default "close running app" check.
#
# Default implementation lives in
#   app-builder-lib/templates/nsis/include/allowOnlyOneInstallerInstance.nsh
# (macro _CHECK_APP_RUNNING). For non-perMachine installs it runs:
#   tasklist /FI "USERNAME eq %USERNAME%" /FI "IMAGENAME eq Q-Paste.exe" /FO csv
#     | find.exe "Q-Paste.exe"
# and treats the pipeline exit code 0 as "app still running". On this machine that
# check keeps reporting the app as running even when no Q-Paste.exe process exists,
# so the installer deadlocks on the "Q-Paste cannot be closed / click Retry" dialog
# and the install never completes.
#
# Use the nsProcess plug-in instead: it walks the toolhelp process snapshot and
# matches the image name exactly, then force-closes the app before files are copied.

!include "nsProcess.nsh"

!macro customCheckAppRunning
  ${nsProcess::FindProcess} "Q-Paste.exe" $R0
  ${if} $R0 == 0
    nsExec::Exec 'taskkill /im "Q-Paste.exe" /f'
    Sleep 1500
  ${endIf}
!macroend
