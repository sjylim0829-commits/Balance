@echo off
cd /d "%~dp0"
title Balance Game Server

if exist "%LOCALAPPDATA%\Programs\Python\Python311\python.exe" (
    "%LOCALAPPDATA%\Programs\Python\Python311\python.exe" run.py
    pause
    exit /b
)

python run.py
if %errorlevel% neq 0 (
    echo [오류] Python 실행에 실패했습니다.
    pause
)
