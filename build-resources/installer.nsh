; 自定义 NSIS 安装脚本 - 在 isRunning 检测之前强制关闭进程
!macro customInit
  ; 强制杀掉所有 GuaDa 进程树（含 NestJS 子进程），释放文件锁
  nsExec::ExecToLog 'taskkill /f /im "GuaDa.exe" /t 2>nul'
  ; 等待进程完全退出 + 文件句柄释放（关键！）
  Sleep 2000
  ; 二次确认清理干净
  nsExec::ExecToLog 'taskkill /f /im "GuaDa.exe" /t 2>nul'
  Sleep 500
!macroend
