' create-shortcut.vbs — Windows-only helper that creates a desktop shortcut
' for the dev launcher (launch-latest.vbs).
'
' macOS users: install the .dmg from GitHub Releases — it places Nexus.app in
'              Applications and you can drag it to the Dock.
' Linux users: install the .deb / .AppImage — both register a desktop entry.

Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

desktopPath = shell.SpecialFolders("Desktop")
projectDir = fso.GetParentFolderName(WScript.ScriptFullName)
targetVbs = projectDir & "\launch-latest.vbs"
iconPath = projectDir & "\public\nexus.ico"
shortcutPath = desktopPath & "\Nexus.lnk"

Set shortcut = shell.CreateShortcut(shortcutPath)
shortcut.TargetPath = "wscript.exe"
shortcut.Arguments = """" & targetVbs & """"
shortcut.WorkingDirectory = projectDir
shortcut.WindowStyle = 7
shortcut.Description = "Nexus — desktop AI companion"

If fso.FileExists(iconPath) Then
    shortcut.IconLocation = iconPath & ",0"
End If

shortcut.Save

MsgBox "Nexus desktop shortcut created.", vbInformation, "Nexus"
