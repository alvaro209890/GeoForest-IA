@echo off
cd /d c:\GIS\GeoForest-IA
echo [%date% %time%] starting >> .run-logs\frontend-render-3005.log
set VITE_API_BASE=https://geoforest-ia.onrender.com
npm run dev -- --host 0.0.0.0 --port 3005 --strictPort >> .run-logs\frontend-render-3005.log 2>> .run-logs\frontend-render-3005.err.log
echo [%date% %time%] exited with %errorlevel% >> .run-logs\frontend-render-3005.log
