@echo off
set PATH=C:\Windows\System32;C:\Windows
for /f "tokens=2,*" %%A in ('reg query "HKLM\SYSTEM\CurrentControlSet\Control\Session Manager\Environment" /v Path 2^>nul') do set SYS_PATH=%%B
for /f "tokens=2,*" %%A in ('reg query "HKCU\Environment" /v Path 2^>nul') do set USR_PATH=%%B
set PATH=%SYS_PATH%;%USR_PATH%
cd /d e:\Shopify\price-polish-tool

REM ============================================================
REM  SET YOUR STORE PASSWORD HERE (between the quotes):
set PP_STORE_PASSWORD=
REM  Optionally change the product page to test:
set PP_PRODUCT_URL=https://price-polish-test-2.myshopify.com/products/the-3p-fulfilled-snowboard
REM ============================================================

node C:\Users\Admin\.codegpt\skills\browser-automation\browser.mjs "%PP_PRODUCT_URL%" --session pdp --script ./scripts/verify-pdp-session.mjs > ScriptRanResult.txt 2>&1
echo DONE, output saved to ScriptRanResult.txt (exit %ERRORLEVEL%)
