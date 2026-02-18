@echo off
cd /d c:\GIS\GeoForest-IA
echo [%date% %time%] starting >> c:\GIS\GeoForest-IA\.run-logs\frontend-render-3006.log
set VITE_API_BASE=https://geoforest-ia.onrender.com
npm run dev -- --host 0.0.0.0 --port 3006 --strictPort >> c:\GIS\GeoForest-IA\.run-logs\frontend-render-3006.log 2>> c:\GIS\GeoForest-IA\.run-logs\frontend-render-3006.err.log
echo [%date% %time%] exited with %errorlevel% >> c:\GIS\GeoForest-IA\.run-logs\frontend-render-3006.log
