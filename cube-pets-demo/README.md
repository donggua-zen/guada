# Kenney Cube Pets（本地验证包）

来源：https://kenney.nl/assets/cube-pets · 版本 **2.0**（2026-03）· 授权 **CC0 1.0**（商用/修改均免费，无需署名）

## 结论速览

| 问题 | 答案 |
|---|---|
| 能下载吗 | ✅ 免费直接下，`kenney_cube-pets.zip`（2.8 MB，138 个文件，解压 15 MB） |
| 有动画吗 | ✅ 每个模型 **8 段**：`static / idle / walk / run / eat / dance / gesture-positive / gesture-negative` |
| 格式 | GLB（three.js 直读）+ FBX（Unity/Blender/Maya），另有共用调色板 `Textures/colormap.png` |
| 数量 | 24 只动物 |
| 动画实现 | **刚性部件 TRS 关键帧**（body/tail/4 条腿是独立 mesh，没有骨骼蒙皮 `skins: 0`）→ 极好处理 |

## 目录内容

```
models/            24 个 .glb（120–165 KB/个）+ Textures/colormap.png（GLB 靠相对路径引用，必须放一起）
models-fbx/        1 个 .fbx 样例（cat）+ Textures/
kenney_cube-pets.zip  原始包（含 FBX 全套、Previews、License）
pack-preview.png   官方预览图
shot-fox.png       three.js 渲染实拍（颜色正常）
shot-walk.png      three.js 渲染实拍（cat，偏灰蓝）
```

24 只：beaver bee bunny cat caterpillar chick cow crab deer dog elephant fish fox giraffe hog koala lion monkey panda parrot penguin pig polar tiger

## 各动画时长（秒）

| static | idle | walk | run | eat | dance | gesture+ | gesture− |
|---|---|---|---|---|---|---|---|
| 0.10 | 1.00 | 0.50 | 0.25 | 0.50 | 0.50 | 0.25 | 0.25 |

## 本地跑起来

```bash
cd cube-pets-demo
python -m http.server 8899
# 打开 http://127.0.0.1:8899/
```

`index.html` 是**桌宠真实尺寸预览**：右下角透明底、按像素高精确取景（默认 140px，可拖 **48–300px**）、带接地阴影、深浅壁纸切换、8 段动画 + 自动轮播。three.js 走 ESM + importmap（CDN three@0.169.0）。

`compare.html` 是**尺寸对比条**：同一模型按 48 / 64 / 80 / 96 / 120 / 168px 各渲染一张 1:1 图（不是缩放），一眼看出各档位观感。`compare.html?a=tiger` 可换动物。

## 接入要点（踩过的坑）

1. **贴图是调色板图集**（512×512 色块），模型靠 UV 点选色块着色 → 必须
   `map.magFilter = map.minFilter = THREE.NearestFilter` 且 `generateMipmaps = false`，否则相邻色块被 mip 平均，出现串色/发灰。
2. **GLB 的贴图是外链**：`images[0].uri = "Textures/colormap.png"`，不是内嵌 → 拷贝模型时必须带上 `Textures/` 目录，否则模型纯白。
3. 动画是 `AnimationClip`，`names` 见上表；`mixer.clipAction(clip)` + `LoopRepeat` 即可循环。
4. 场景包围盒（cat）：约 `1.25 × 1.70 × 1.33`，脚底在 y≈-0.3，缩放时按身高归一即可。
5. 颜色抽查：fox / tiger / polar / koala 正常；**cat、bee 渲染偏灰蓝**（UV 落在灰蓝色块），这两只想用的话建议先在 Blender 里确认或自己改材质色。
6. **动画剪辑挂在 `gltf.animations`，不是 `gltf.scene.animations`** —— 取后者是 `undefined`，`AnimationClip.findByName(undefined, …)` 直接抛错，表现就是「点了按钮没反应」。
7. **walk / run 带 `root.position` 轨道**（整体位移，播放时会走向镜头）。桌宠要原地动，必须剥离：
   ```js
   for (const c of clips) c.tracks = c.tracks.filter(t => t.name !== 'root.position');
   ```

## 后续转图片（可行）

因为动画是纯节点 TRS，没有蒙皮，可以离线逐帧渲染成序列帧：
- 用 headless Chromium + 本 demo 的 three.js 场景，`mixer.setTime(t)` 后 `canvas.toDataURL()` 抓帧 → 拼 sprite sheet；
- 或 Blender 导入 GLB，Blender 直接按帧渲染 PNG 序列；
- 帧数参考：idle 1.0s@12fps=12 帧、walk 0.5s@12fps=6 帧，一张小图集即可覆盖全部动作。
