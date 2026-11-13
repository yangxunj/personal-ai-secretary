@echo off
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0isolated-pilot.ps1" -Action Run
if errorlevel 1 pause
