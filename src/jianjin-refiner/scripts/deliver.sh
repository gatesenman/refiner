#!/usr/bin/env bash
# 汇总交付物到 dist-deliver/
set -e
cd "$(dirname "$0")/.."
D=dist-deliver
rm -rf "$D" && mkdir -p "$D/截图"
V=$(node -p "require('./package.json').version")
cp release/JianJin-Refiner-$V-Setup.exe release/JianJin-Refiner-$V-Portable.exe release/JianJin-Refiner-$V-win-x64.zip "$D/"
cp docs/规划文档.md docs/使用说明.md "$D/"
[ -f docs/真实模型测试记录.md ] && cp docs/真实模型测试记录.md "$D/"
cp .shots/*.png "$D/截图/" 2>/dev/null || true
[ -f /workspace/wine-shot-crop.png ] && cp /workspace/wine-shot-crop.png "$D/截图/00-Windows版在wine中运行.png"
python3 -c "import zipfile,os,sys
z=zipfile.ZipFile(sys.argv[1],'w',zipfile.ZIP_DEFLATED)
for p in sys.argv[2:]:
  if os.path.isfile(p): z.write(p,'jianjin-refiner/'+p)
  else:
    for r,d,fs in os.walk(p):
      for f in fs: q=os.path.join(r,f); z.write(q,'jianjin-refiner/'+q)
z.close()" "$D/渐进Refiner-源码.zip" README.md package.json package-lock.json tsconfig.json vite.config.ts vitest.config.ts build docs plugins scripts src tests
(cd "$D" && sha256sum *.exe *.zip > SHA256SUMS.txt)
# 安装包分卷（每卷 ≤22MB（22,000,000 字节，同时小于 22 MiB）），便于受附件大小限制的渠道传输
mkdir -p "$D/split"
split -b 22000000 -d -a 1 "$D/JianJin-Refiner-$V-Setup.exe" "$D/split/JianJin-Refiner-$V-Setup.exe.part"
N=$(ls "$D/split" | wc -l)
PARTS=$(for i in $(seq 0 $((N-1))); do printf 'JianJin-Refiner-%s-Setup.exe.part%d' "$V" "$i"; if [ $i -lt $((N-1)) ]; then printf '+'; fi; done)
cat > "$D/split/合并说明.txt" <<TXT
JianJin-Refiner-$V-Setup.exe 已分为 $N 卷（part0 … part$((N-1))，每卷不超过 22MB）。
把所有分卷放在同一文件夹，然后合并：

Windows（命令提示符 cmd，在该文件夹中执行）：
  copy /b $PARTS JianJin-Refiner-$V-Setup.exe

Windows PowerShell：
  cmd /c copy /b $PARTS JianJin-Refiner-$V-Setup.exe

macOS / Linux：
  cat JianJin-Refiner-$V-Setup.exe.part? > JianJin-Refiner-$V-Setup.exe

合并后请核对 SHA256（应与下面一致）：
  certutil -hashfile JianJin-Refiner-$V-Setup.exe SHA256
$(cd "$D" && sha256sum JianJin-Refiner-$V-Setup.exe)
TXT
(cd "$D/split" && sha256sum *.part* > SHA256SUMS-parts.txt)
cat "$D"/split/*.part* | cmp - "$D/JianJin-Refiner-$V-Setup.exe" && echo "分卷校验：合并结果与原文件一致"
ls -la "$D" "$D/截图" "$D/split"
