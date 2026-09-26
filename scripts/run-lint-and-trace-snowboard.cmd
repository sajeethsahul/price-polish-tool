# File: scripts/run-lint-and-trace-snowboard.cmd
@echo off
set PATH=C:\Windows\System32;C:\Windows
for /f "tokens=2,*" %%A in ('reg query "HKLM\SYSTEM\CurrentControlSet\Control\Session Manager\Environment" /v Path 2^>nul') do set SYS_PATH=%%B
for /f "tokens=2,*" %%A in ('reg query "HKCU\Environment" /v Path 2^>nul') do set USR_PATH=%%B
set PATH=%SYS_PATH%;%USR_PATH%
cd /d e:\Shopify\price-polish-tool

echo === LINT ===
node node_modules\eslint\bin\eslint.js extensions\price-polish-extension\assets\price-polish.js
echo ESLINT EXIT: %ERRORLEVEL%
echo.
echo === Deploy updated extension first (shopify app dev / theme push), then: ===
echo 1. Open https://price-polish-test-2.myshopify.com/products/the-3p-fulfilled-snowboard
echo 2. DevTools console filter: PricePolish
echo 3. Look for the new line:  Filter dropped N matched price element(s):
echo 4. Paste that block (with ancestors=[...] and reason) back.
pause
