; 自定义 NSIS 卸载脚本 - 清理用户数据
!macro customUnInstall
  ; 直接清理用户数据目录（包含数据库、文件存储等所有数据）
  RMDir /r "$APPDATA\GuaDa"
  RMDir /r "$LOCALAPPDATA\GuaDa"
!macroend
