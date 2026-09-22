@echo off
chcp 65001 >nul
title GitHub Push - Balance Game

set "PATH=%LOCALAPPDATA%\Programs\MinGit\cmd;%LOCALAPPDATA%\Programs\MinGit\mingw64\bin;%PATH%"

echo ========================================================
echo   🚀 GitHub에 커밋 및 푸시를 진행합니다...
echo   대상: https://github.com/sjylim0829-commits/Balance.git
echo ========================================================
echo.

git add .
git commit -m "feat: real-time balance game with Firebase" 2>nul
git branch -M main

echo.
echo [안내] GitHub 로그인 브라우저 창이 열리면 [Authorize]를 눌러주세요.
echo.
git push -u origin main

if %errorlevel% equ 0 (
    echo.
    echo ========================================================
    echo   🎉 성공! GitHub에 모든 코드가 푸시되었습니다!
    echo ========================================================
) else (
    echo.
    echo [알림] 푸시 중 문제가 발생했거나 인증이 취소되었습니다.
)

echo.
pause
