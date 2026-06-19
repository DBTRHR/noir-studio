' NOIR Studio launcher — starts the local server (hidden) and opens the app.
Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
appDir = fso.GetParentFolderName(WScript.ScriptFullName)
sh.CurrentDirectory = appDir
' Start the static server hidden. If port 8777 is already in use, this exits
' quietly and the browser just opens the already-running server.
sh.Run "cmd /c python -m http.server 8777", 0, False
WScript.Sleep 1500
sh.Run "http://localhost:8777/", 1, False
