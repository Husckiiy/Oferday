Set WshShell = CreateObject("WScript.Shell")
WshShell.CurrentDirectory = "C:\Users\Administrator\Desktop\bot"
WshShell.Environment("PROCESS")("PATH") = "D:\Node;" & WshShell.Environment("PROCESS")("PATH")
WshShell.Run "cmd /c start-bot.bat", 0, False
