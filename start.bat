@echo off
echo ========================================
echo   TestGenerate Agent 启动脚本
echo ========================================
echo.

echo [1/3] 启动后端服务器...
start "Backend Server" cmd /k "cd /d %~dp0 && npm run server:dev"

echo [2/3] 等待后端启动...
timeout /t 3 /nobreak > nul

echo [3/3] 启动前端开发服务器...
start "Frontend Dev" cmd /k "cd /d %~dp0\client && npm run dev"

echo.
echo ========================================
echo   启动完成！
echo   后端: http://localhost:3000
echo   前端: http://localhost:5173
echo ========================================
echo.
pause
