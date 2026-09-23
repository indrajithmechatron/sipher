@echo off
rem Sipher Mission Control — application entry point
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0Launch-SipherDashboard.ps1" %*
if /I "%~1"=="-ServerOnly" pause
