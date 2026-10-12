# 桌宠动画素材流水线

把 AI 生成的 10 秒动作视频，转成记账页面上能播的**透明动画**。

配方（提示词）在 `docs/features/PET_VIDEO_PROMPTS.md`；这里只讲**素材怎么处理**。

## 目录

```
pet-assets/
├── scripts/
│   ├── make-green.py         ① 近白/偏灰绿/黑底 → 纯 #00FF00 绿幕
│   ├── green_to_alpha.py     ② 绿幕 → 透明 webm（VP9-alpha）
│   └── normalize_step03.py   ③ 尺寸与站位归一化 → 2160x1215 母版
├── source/       ← 你生成的原始视频（*.mp4）。丢了就得重新生成，务必留着
├── alpha/        ← ②的产物，透明中间态（可由 source/ 重算，不发布）
├── normalized/   ← ③的产物，2160x1215 母版（存档，不发布）
│   └── params.json   ← 每段量到的站立高度/中心/缩放，排查对齐问题时先看它
└── playback/     ← 待生成：640x360 播放版（**唯一要发布的东西**）
```

`source/`、`alpha/`、`normalized/`、`playback/` 都在 `.gitignore` 里——
它们加起来几十 MB，而且都不是应用实际服务的文件。**只有 `playback/` 里的 640×360 版本会被拷进
`public/pet/` 随页面上线。**

## 处理一段素材

```sh
cd client/pet-assets

# ① 绿幕归一化。输入是 AI 直接给你的原片（底色是白/灰绿/黑都行）
/usr/bin/python3 scripts/make-green.py source/新动作.mp4 /tmp/新动作-green.mp4
mv /tmp/新动作-green.mp4 source/新动作-green.mp4

# ② 绿幕 → 透明
/usr/bin/python3 scripts/green_to_alpha.py source/新动作-green.mp4

# ③ 归一化（会处理 alpha/ 下所有文件）
/usr/bin/python3 scripts/normalize_step03.py
```

> 用 `/usr/bin/python3`，因为只有它带 numpy。（这台机器上 `/usr/local/bin/python3` 带 PIL，
> 两个解释器的库不互通。）

## 三个坑（都踩过，别再重走）

### 1. `alphamerge` 会**完全丢掉 alpha 平面**

"灰度图当第二路输入 + `alphamerge`"这条路走不通：

```
写入 alpha 0 / 255  →  解出 76 / 150
写入渐变  0..255    →  解出恒为 118      ← 完全没有 alpha
```

`118` 是"没有 alpha 平面时色度取中性值 128"的展开值。**必须把 RGBA 原始帧直接喂给
`libvpx-vp9`**，alpha 才能无损通过（写入 0 / 128 / 255 → 解出 0 / 129 / 255）。
`green_to_alpha.py` 已经这么做了。

### 2. 验证 VP9 alpha **必须**指定解码器

```sh
ffmpeg -c:v libvpx-vp9 -i x.webm -vf alphaextract ...   # 显式指定，否则 alpha 丢失
```

不指定时 ffmpeg 自动选的解码器会丢 alpha——我因此一度误判成"这台 ffmpeg 不支持 alpha"。
另外 **`ffprobe` 对这类文件永远显示 `yuv420p`**（alpha 是 side data），不能拿它判断有没有 alpha。

### 3. AI 生成的首帧可能是**参考图版式**，不是动作画面

见过一整帧是"角色三视图 + 细节特写"的版式，它的 bbox 横跨整个画幅（`x[10,1269]`），
会污染归一化的测量窗口。归一化只读**首尾各 5 帧**，所以脏帧最容易被读到。

处理：裁掉脏帧后再归一化。

```sh
# 裁掉首帧（trim 比 select 可靠）
ffmpeg -y -c:v libvpx-vp9 -i alpha/x.webm \
  -vf "trim=start_frame=1,setpts=PTS-STARTPTS" \
  -c:v libvpx-vp9 -crf 24 -b:v 0 -auto-alt-ref 0 -cpu-used 4 -pix_fmt yuva420p alpha/x-trim.webm
```

**每次生成后先看一眼首帧**，是最省事的做法。

## 归一化在做什么

`normalize_step03.py` 把每段统一到 **2160×1215（16:9）**：

- **缩放**：按"首尾各 5 帧的站立高度"缩放，使站立高度 = **900px**
- **垂直**：脚底对齐到 `FEET_Y = 1115`（距画布底边 100px）
- **水平**：按非透明像素 x 的**中位数**居中（用中位数而非 bbox 中心，防止手/道具把中心拉偏）

量到的值写在 `normalized/params.json`，排查"某段偏大偏小"时先看它。

**它的前提**是首尾帧为完整站立姿态。若某段脚底被画幅裁切，量到的高度偏小 → 缩放偏大 →
那一段会明显偏大。生成时务必在提示词里强调**头顶留白 ≥15%、脚底留白 ≥10%**。

## 当前进度

| 段落 | 对应状态 | source | normalized |
|---|---|---|---|
| 待机呼吸 | `idle` 池 | ✓ | ✓ |
| 思考翻书 | AI 请求中 | ✓ | ✓ |
| 低头记一笔 | 工具执行中 | ✓ | ✓ |
| 数钱满意 | 写入成功 | ✓ | ✓ |
| 出错冒汗 | 写入失败 / 409 | ✓ | ✓（**脚底被裁，待重生成**） |

待生成：打算盘对账、逾期提醒、被拎起来、没电了、打招呼欢迎。

五个母版的对齐实测（第 30 帧）：身高 896~909、脚底 1112~1114、中心 x 1076~1090，
对目标 900 / 1115 / 1080 的偏差都在 1.4% 以内。
