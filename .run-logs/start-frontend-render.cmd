@echo off
cd /d c:\GIS\GeoForest-IA
set VITE_API_BASE=https://geoforest-ia.onrender.com
npm run dev -- --host 0.0.0.0 --port 3003 --strictPort
