@echo off
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0desktop-pilot.ps1" -Action Run
if errorlevel 1 pause
