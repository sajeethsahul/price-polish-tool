@echo off
set PATH=C:\Windows\System32;C:\Windows
for /f "tokens=2,*" %%A in ('reg query "HKLM\SYSTEM\CurrentControlSet\Control\Session Manager\Environment" /v Path 2^>nul') do set SYS_PATH=%%B
for /f "tokens=2,*" %%A in ('reg query "HKCU\Environment" /v Path 2^>nul') do set USR_PATH=%%B
set PATH=%SYS_PATH%;%USR_PATH%
cd /d e:\Shopify\price-polish-tool
node node_modules\eslint\bin\eslint.js extensions/price-polish-extension/assets/price-polish.js tests/price-polish.browser.mjs
echo ESLINT EXIT: %ERRORLEVEL%
