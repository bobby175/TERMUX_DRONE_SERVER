#!/bin/bash

# Tangkap sinyal CTRL+C untuk mematikan semua proses sekaligus
trap 'echo -e "\n[!] Mematikan server..."; kill $MEDIAMTX_PID; exit' INT

echo -e "\e[1;36m===================================================\e[0m"
echo -e "\e[1;36m        MEMULAI DRONE LIVE SYSTEM (TERMUX)\e[0m"
echo -e "\e[1;36m===================================================\e[0m"
echo ""

# 1. Pastikan Node.js terinstall di Termux
if ! command -v node &> /dev/null; then
    echo "[!] Node.js belum terinstall. Menginstall nodejs..."
    pkg update -y && pkg install nodejs -y
fi

# 2. Pastikan MediaMTX (versi ARM64 Linux) ada
if [ ! -f "./mediamtx" ]; then
    echo "[!] MediaMTX (Linux ARM64) tidak ditemukan di folder ini."
    echo "[*] Mendownload MediaMTX dari GitHub..."
    pkg update -y && pkg install wget tar -y
    
    # Download versi terbaru (linux-arm64 yang cocok untuk HP Android/Termux)
    wget -qO mediamtx.tar.gz "https://github.com/bluenviron/mediamtx/releases/download/v1.9.3/mediamtx_v1.9.3_linux_arm64.tar.gz"
    
    echo "[*] Mengekstrak MediaMTX..."
    tar -xzf mediamtx.tar.gz mediamtx mediamtx.yml
    rm mediamtx.tar.gz
    chmod +x mediamtx
    echo "[*] MediaMTX berhasil diunduh!"
fi

# 3. Jalankan MediaMTX di Background (&)
echo -e "\e[1;32m[*] Menjalankan MediaMTX (Termux)...\e[0m"
./mediamtx > mediamtx.log 2>&1 &
MEDIAMTX_PID=$!

sleep 2 # Tunggu 2 detik agar port terbuka

# 4. Install dependencies Node jika belum ada
if [ ! -d "./node_modules" ]; then
    echo "[*] Menginstall modul Node.js..."
    # --no-bin-links penting di Termux agar tidak error symlink
    npm install --no-bin-links 
fi

# 5. Jalankan Dashboard Server
echo -e "\e[1;32m[*] Menjalankan Dashboard Server (Node.js)...\e[0m"
node server.js
