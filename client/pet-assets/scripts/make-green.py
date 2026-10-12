"""宠物源视频 -> 纯 #00FF00 绿幕（逐帧自适应：近白底 / 偏灰绿底 / 黑底）

每帧独立判断底色并抠像合成到纯绿：
  - 绿底（AI 常给偏灰绿）："绿占优"判据 (G - max(R,B)) > 25
  - 黑底：最大通道 <= 20（只认近纯黑，不吃深蓝描边）
  - 近白底：角部中位为白，且全图确有足够比例近白（防过渡帧误判）
一切掩膜都用【从画布边缘洪泛】得到，所以角色身上的白（围裙/头饰）与深色（裙/发）不丢。
另外：AI 生成的首帧常是"角部为白、整体发灰"的过渡帧，这类帧识别不出底色，
统一用其后第一帧可识别画面顶上，避免它带着偏色进片。
"""
import numpy as np, subprocess, sys, os

W,H = 1280,720
FEATHER = 1
GREEN = np.array([0,255,0],dtype=np.float32)
DARK_MAX = 20
WHITE_MIN_SHARE = 0.50   # 真白底应有 70%+ 近白；过渡帧只约 20%

def log(*a): print(*a, flush=True)

def read_frames(path):
    raw = subprocess.run(["ffmpeg","-v","error","-i",path,"-f","rawvideo","-pix_fmt","rgb24","-"],
                         capture_output=True).stdout
    n = len(raw)//(W*H*3)
    return np.frombuffer(raw,dtype=np.uint8).reshape(n,H,W,3), n

def corner_bg(a):
    k=40
    c=np.concatenate([a[:k,:k].reshape(-1,3),a[:k,-k:].reshape(-1,3),
                      a[-k:,:k].reshape(-1,3),a[-k:,-k:].reshape(-1,3)])
    return np.median(c,axis=0)

def flood(m):
    cur = np.zeros_like(m)
    cur[0,:]=m[0,:]; cur[-1,:]=m[-1,:]; cur[:,0]=m[:,0]; cur[:,-1]=m[:,-1]
    while True:
        nxt = cur.copy()
        nxt[1:,:] |= cur[:-1,:]; nxt[:-1,:] |= cur[1:,:]
        nxt[:,1:] |= cur[:,:-1]; nxt[:,:-1] |= cur[:,1:]
        nxt &= m
        if np.array_equal(nxt,cur): return cur
        cur = nxt

def background_mask(a):
    """返回 (背景掩膜, 类型)。类型为 None 表示"过渡帧"，调用方应替换该帧。"""
    a16 = a.astype(np.int16)
    r,g,b = corner_bg(a)
    if g > r+30 and g > b+30:
        return (a16[:,:,1] - np.maximum(a16[:,:,0], a16[:,:,2])) > 25, "green"
    if r > 230 and g > 230 and b > 230:
        near = np.abs(a16-np.array([r,g,b],dtype=np.int16)).max(axis=2) <= 16
        if near.mean() >= WHITE_MIN_SHARE:
            return near, "white"
        return near, None          # 角部白但整体不是白底 -> 过渡帧
    return a16.max(axis=2) <= DARK_MAX, "dark"

def alpha_for(a):
    near,_ = background_mask(a)
    al = np.where(flood(near), 0.0, 1.0).astype(np.float32)
    if FEATHER:
        pad = np.pad(al,FEATHER,mode="edge"); acc = np.zeros_like(al)
        for dy in range(-FEATHER,FEATHER+1):
            for dx in range(-FEATHER,FEATHER+1):
                acc += pad[FEATHER+dy:FEATHER+dy+H, FEATHER+dx:FEATHER+dx+W]
        al = acc/((2*FEATHER+1)**2)
    return al

def despill(rgb):
    r=rgb[:,:,0]; g=rgb[:,:,1]; b=rgb[:,:,2]
    over=(g-np.maximum(r,b))>60
    if over.any():
        rgb=rgb.copy(); rgb[:,:,1]=np.where(over, np.minimum(g,np.maximum(r,b)+20), g)
    return rgb

def main():
    src, out = sys.argv[1], sys.argv[2]
    frames,n = read_frames(src)
    log(f"frames={n} {W}x{H}")
    # 先扫一遍，找出第一个"可识别"的帧，用于顶替开头/中间的过渡帧
    kinds=[]; first_good=None
    for i in range(n):
        _,kind = background_mask(frames[i])
        kinds.append(kind)
        if kind and first_good is None: first_good=i
    log(f"frame kinds: green={kinds.count('green')} dark={kinds.count('dark')} white={kinds.count('white')} transition={kinds.count(None)}  first_good={first_good}")
    if first_good is None: log("no usable frame"); sys.exit(1)
    raw=out+".rgb"
    with open(raw,"wb") as f:
        last=None
        for i in range(n):
            src_frame = frames[i] if kinds[i] else frames[first_good]
            if not kinds[i]: log(f"  frame {i} 是过渡帧 -> 用 frame {first_good} 顶替")
            al=alpha_for(src_frame)
            rgb=despill(src_frame.astype(np.float32))
            comp=rgb*al[...,None]+GREEN*(1-al)[...,None]
            f.write(np.clip(comp,0,255).astype(np.uint8).tobytes())
            if i%40==0: log(f"  {i}/{n}")
    log("composite done")
    cmd=["ffmpeg","-v","error","-y",
        "-f","rawvideo","-pix_fmt","rgb24","-s",f"{W}x{H}","-r","24","-i",raw,
        "-i",src,"-map","0:v","-map","1:a?","-c:v","libx264","-crf","18","-preset","veryfast",
        "-pix_fmt","yuv420p","-c:a","copy","-shortest",out]
    r=subprocess.run(cmd,capture_output=True,text=True)
    if r.returncode: log("FFMPEG FAIL:", r.stderr[-1200:]); sys.exit(1)
    os.remove(raw); log("ALL DONE ->", out)

main()
