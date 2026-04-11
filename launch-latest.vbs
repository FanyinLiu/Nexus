Option Explicit

Dim shell, fso
Dim projectDir, projectDirLower
Dim electronExe, distIndex
Dim omniVoicePort, omniVoiceScript, omniVoicePython
Dim buildCommand, launchCommand
Dim exitCode

Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

projectDir = fso.GetParentFolderName(WScript.ScriptFullName)
projectDirLower = LCase(projectDir)
electronExe = projectDir & "\node_modules\electron\dist\electron.exe"
distIndex = projectDir & "\dist\index.html"
omniVoicePort = 8000
omniVoiceScript = projectDir & "\scripts\omnivoice_server.py"
omniVoicePython = "python"

If Not fso.FileExists(electronExe) Then
  MsgBox "Desktop Pet AI launcher error: electron.exe was not found. Please run npm install in the project folder first.", vbCritical, "Desktop Pet AI"
  WScript.Quit 1
End If

StopProjectProcesses projectDirLower

shell.CurrentDirectory = projectDir

buildCommand = "cmd.exe /c npm.cmd run build"
exitCode = shell.Run(buildCommand, 0, True)
If exitCode <> 0 Then
  MsgBox "Desktop Pet AI launcher error: build failed. Please open the project folder and run npm run build to inspect the error.", vbCritical, "Desktop Pet AI"
  WScript.Quit exitCode
End If

If Not fso.FileExists(distIndex) Then
  MsgBox "Desktop Pet AI launcher error: dist\index.html was not generated after build.", vbCritical, "Desktop Pet AI"
  WScript.Quit 1
End If

EnsureOmniVoiceRunning

launchCommand = """" & electronExe & """ ."
shell.Run launchCommand, 1, False

Sub EnsureOmniVoiceRunning()
  If IsPortOpen("127.0.0.1", omniVoicePort) Then
    Exit Sub
  End If

  If Not fso.FileExists(omniVoiceScript) Then
    Exit Sub
  End If

  Dim cmd
  cmd = "cmd.exe /c start /min """" " & omniVoicePython & " """ & omniVoiceScript & """ --port " & CStr(omniVoicePort)
  shell.Run cmd, 0, False

  WaitForPort "127.0.0.1", omniVoicePort, 30
End Sub

Sub StopProjectProcesses(targetDirLower)
  Dim service, processes, proc, cmdLine

  Set service = GetObject("winmgmts:\\.\root\cimv2")
  Set processes = service.ExecQuery( _
    "SELECT ProcessId, Name, CommandLine FROM Win32_Process WHERE Name='electron.exe' OR Name='node.exe'")

  For Each proc In processes
    cmdLine = ""

    On Error Resume Next
    cmdLine = LCase(CStr(proc.CommandLine))
    On Error GoTo 0

    If Len(cmdLine) > 0 Then
      If InStr(cmdLine, targetDirLower) > 0 Then
        On Error Resume Next
        proc.Terminate()
        On Error GoTo 0
      End If
    End If
  Next
End Sub

Function WaitForPort(host, port, timeoutSeconds)
  Dim attempt, maxAttempts

  maxAttempts = timeoutSeconds
  For attempt = 1 To maxAttempts
    If IsPortOpen(host, port) Then
      WaitForPort = True
      Exit Function
    End If

    WScript.Sleep 1000
  Next

  WaitForPort = IsPortOpen(host, port)
End Function

Function IsPortOpen(host, port)
  Dim testCommand, exitCode

  testCommand = "powershell.exe -NoProfile -ExecutionPolicy Bypass -Command ""$r = Test-NetConnection -ComputerName '" & host & "' -Port " & CStr(port) & " -InformationLevel Quiet; if ($r) { exit 0 } else { exit 1 }"""
  exitCode = shell.Run(testCommand, 0, True)
  IsPortOpen = (exitCode = 0)
End Function
