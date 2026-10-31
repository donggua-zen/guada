# 3D → 序列帧 → 桌宠（纯图片运行时）

结论：**完全可行，且这是最稳的路线**。已在本目录跑通全链路。

## 三步流程

```
① 3D 模型（.glb，8 段动画）
        ↓  bake.html：three.js 离线逐帧渲染
② 透明 PNG / WebP 序列帧 + 横向雪碧图 + meta.json
        ↓  sprite.html：CSS steps() 切帧
③ 桌宠运行时：只有 <div> + background-position，零 WebGL
```

## 一、烘焙（`bake.html`）

打开 http://127.0.0.1:8899/bake.html ，选动物 / 像素高 / 帧率 / 格式，点「开始烘焙」。
产物会通过本地接收服务（`bake_server.py`，端口 8900）写入 `bake_out/<animal>/`。

关键实现：

```js
mixer.setTime((i / frames) * clip.duration);   // 逐帧定时刻（首尾不重复，避免循环抖动）
renderer.render(scene, camera);
canvas.toDataURL(mime, 0.92);                  // preserveDrawingBuffer: true 才能取到
```

雪碧图 = 把每帧横向拼成一排：`宽 = 单帧宽 × 帧数`。

## 二、fox @ 120px 实测数据（12fps）

| 动画 | 帧数 | 时长 | 雪碧图尺寸 |
|---|---|---|---|
| static | 2 | 0.10s | 504×252 |
| idle | 12 | 1.00s | 3024×252 |
| walk | 6 | 0.50s | 1512×252 |
| run | 3 | 0.25s | 756×252 |
| eat | 6 | 0.50s | 1512×252 |
| dance | 6 | 0.50s | 1512×252 |
| gesture-positive | 3 | 0.25s | 756×252 |
| gesture-negative | 3 | 0.25s | 756×252 |

**共 41 帧。体积：**

| 格式 | 8 张雪碧图合计 | 说明 |
|---|---|---|
| PNG | **676 KB** | 无损，边缘最锐 |
| WebP q0.92 | **160 KB** | 推荐，肉眼几乎无差 |

单帧 PNG 约 24–28 KB；`bake_out/fox/` 里同时保留单帧序列（49 张 PNG + 雪碧图 + meta.json）。

帧间确实有变化（像素级 diff）：
`walk_000 vs walk_003` → **15.8%** 像素变化；`idle_000 vs idle_006` → 13.2%；相邻帧 2.4%（呼吸的细微起伏）。

## 三、运行时（`sprite.html`）

打开 http://127.0.0.1:8899/sprite.html

核心就 8 行 CSS，**没有任何 WebGL**：

```css
@keyframes play-idle { from { background-position: 0 0; } to { background-position: -3024px 0; } }
.play-idle { animation: play-idle 1s steps(12) infinite; }
```

```js
pet.style.backgroundImage = `url("bake_out/fox/sheet_idle.webp")`;
pet.style.backgroundSize = `${frames * size}px ${size}px`;  // size = 单帧显示边长
pet.classList.add('play-idle');
```

页面提供：8 动作切换、缩放（0.5–2×，等比放大不重烘）、左右翻转（`scaleX(-1)`）、深浅壁纸切换。

## 四、为什么这条路更适合桌宠

| | 实时 3D | 烘成图集 |
|---|---|---|
| GPU 占用 | 每帧重绘 canvas | 0（纯合成层） |
| 透明窗口闪烁 | **有风险**（DWM 每帧重合成，Tauri #15490/#14831） | **无** |
| 低端机 / 核显 | 吃力 | 无压力 |
| 包体积 | 24 个 glb ≈ 3.3 MB | 单动物 160 KB（WebP） |
| 加新动作 | 改代码 | 重烘一次 |
| 换角度/换装/跟随鼠标 | 支持 | 不支持（预烘固定视角） |

结论：**固定视角 + 有限动作 = 烘图集完胜**。只有需要任意角度/实时换装时才回到 3D。

## 五、还可以再优化（按收益排序）

1. **整只动物打成一个图集**（所有动作竖排 or 网格），一次 HTTP 请求，减少 8 个请求开销。
2. **降帧率到 8fps**：这些动画本来就很短，8fps 观感差别很小，体积再降 ~30%。
3. **只用 WebP**，并在 `bake.html` 里把 quality 从 0.92 调到 0.85（体积再降一半，肉眼无差）。
4. **按实际显示尺寸烘**：桌宠定 96px 就别用 120px 烘，省一半像素。
5. 需要更细腻的 idle 时，可以把 idle 单独提到 15–20fps，其它动作保持 8fps（混合帧率）。

## 六、文件清单

```
bake.html          烘焙页面（选参数 → 逐帧渲染 → 拼图 → 上传）
bake_server.py     本地接收服务（POST → 落盘 bake_out/），端口 8900
sprite.html        纯图片桌宠运行时（零 3D）
bake_out/fox/      41 帧 PNG 序列 + 8 张雪碧图(PNG/WebP) + meta.json
```

启动：

```bash
cd D:\AI\ai_chat\cube-pets-demo
python -m http.server 8899          # 页面服务
python bake_server.py               # 烘焙落盘服务（需要重新烘焙时）
```
