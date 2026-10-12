"""绿幕 mp4 -> 透明 webm（VP9-alpha）= 素材链的 step02

两条经验（都踩过坑）：
1. alpha 用 numpy 的"绿占优"判据算出：背景 = (G - max(R,B)) > 25。
   比 ffmpeg 的 chromakey 稳，且不会误伤蓝发/白围裙。
2. **必须把 RGBA 原始帧直接喂给 libvpx-vp9**。
   走 `alphamerge`（拿灰度图当第二路输入）这条路，alpha 平面会被整个丢掉 ——
   实测解回来的 alpha 是个常数（色度取中性的展开值），画面全不透明。
   直接喂 RGBA 时 alpha 无损：写入 0/128/255 → 解出 0/129/255。
3. 顺序：先用**原始（未抠像）RGB** 配 alpha，再编码。若先把背景刷成绿再配 alpha，
   半透明边缘会把绿混进角色轮廓。
"""
from __future__ import annotations
import os, subprocess, sys
import numpy as np

W, H, FPS = 1280, 720, 24
GREEN_DOM = 25
CHUNK = 24          # 每次喂给 ffmpeg 的帧数，避免一次性占满内存

def log(*a): print(*a, flush=True)

def decode_rgb(path):
    raw = subprocess.run(
        ["ffmpeg","-v","error","-i",path,"-f","rawvideo","-pix_fmt","rgb24","-"],
        capture_output=True, check=True).stdout
    n = len(raw) // (W*H*3)
    return np.frombuffer(raw, dtype=np.uint8).reshape(n, H, W, 3)

def alpha_of(frames):
    f = frames.astype(np.int16)
    background = (f[..., 1] - np.maximum(f[..., 0], f[..., 2])) > GREEN_DOM
    return np.where(background, 0, 255).astype(np.uint8)   # (n,H,W)

def main():
    here = os.path.dirname(os.path.abspath(__file__))
    out_dir = os.path.normpath(os.path.join(here, "..", "alpha"))
    os.makedirs(out_dir, exist_ok=True)
    for src in sys.argv[1:]:
        frames = decode_rgb(src)
        alpha = alpha_of(frames)
        assert alpha.shape == frames.shape[:3], f"alpha {alpha.shape} vs {frames.shape[:3]}"
        dst = os.path.join(out_dir, os.path.splitext(os.path.basename(src))[0] + ".webm")
        log(f"  {os.path.basename(src)}: {len(frames)} frames")
        p = subprocess.Popen(
            ["ffmpeg","-v","error","-y",
             "-f","rawvideo","-pix_fmt","rgba","-s",f"{W}x{H}","-r",str(FPS),"-i","-",
             "-c:v","libvpx-vp9","-crf","24","-b:v","0",
             "-auto-alt-ref","0","-row-mt","1","-cpu-used","4",
             "-pix_fmt","yuva420p", dst],
            stdin=subprocess.PIPE, stderr=subprocess.PIPE)
        try:
            for start in range(0, len(frames), CHUNK):
                end = min(start + CHUNK, len(frames))
                rgba = np.empty((end-start, H, W, 4), dtype=np.uint8)
                rgba[..., :3] = frames[start:end]
                rgba[..., 3] = alpha[start:end]
                p.stdin.write(rgba.tobytes())
        finally:
            p.stdin.close()
            err = p.stderr.read().decode()
            p.wait()
        if p.returncode:
            log("encode FAIL:", err[-600:]); sys.exit(1)
        log(f"  -> {os.path.basename(dst)}")

if __name__ == "__main__":
    main()
