@echo off
title Balance Game Server

if exist "%LOCALAPPDATA%\Programs\Python\Python311\python.exe" (
    "%LOCALAPPDATA%\Programs\Python\Python311\python.exe" run.py
    goto done
)

python run.py
if %errorlevel% equ 0 goto done

echo Python execution failed.
pause

:done
