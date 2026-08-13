"""为各主题补充 --color-dialog-bg / --code-block-bg（及缺失的 --color-input-bg）。
插入位置：每个「排版与细节」注释块之前（亮色块一次、暗色块一次）。"""
import io

#           文件名          (亮色 dialog, code, input)      (暗色 dialog, code, input)   input=None 表示已有
PLAN = {
    'blueprint.css':   (('#ffffff', '#f0f6fc', '#ffffff'), ('#0d3560', '#0a2b4d', '#0a2b4d')),
    'brutalist.css':   (('#ffffff', '#f4f1ea', '#ffffff'), ('#1c1c1c', '#121212', '#161616')),
    'doodle.css':      (('#fbf7ed', '#f3ecdc', None),      ('#2a2620', '#221f19', None)),
    'e-ink.css':       (('#f5f1e8', '#e6e1d3', None),      ('#232321', '#141412', None)),
    'famicom.css':     (('#faf6ed', '#f0ebde', None),      ('#1e1e24', '#141418', None)),
    'pop-comic.css':   (('#ffffff', '#fffdf2', '#ffffff'), ('#211d2b', '#16131c', '#1d1a25')),
    'steampunk.css':   (('#f6eeda', '#ece0c8', '#f6eeda'), ('#2a1f13', '#1d150e', '#241a10')),
    'y2k.css':         (('#ffffff', '#e9edf6', '#ffffff'), ('#1a1d30', '#101221', '#141628')),
    # 仅暗色主题：只补 dialog（code/input 已有），只插入一次（暗色块）
    'cyberpunk.css':   (None,                              ('#101725', None, None)),
    'wandering-earth.css': (None,                          ('#10151c', None, None)),
}

def block(dialog, code, input_):
    lines = ['  /* 弹窗 / 代码块 */']
    if dialog: lines.append(f'  --color-dialog-bg: {dialog};')
    if code:   lines.append(f'  --code-block-bg: {code};')
    if input_: lines.append(f'  --color-input-bg: {input_};')
    return '\n'.join(lines) + '\n\n'

MARK = '  /* 排版与细节 */'
for name, (light, dark) in PLAN.items():
    p = f'frontend/public/themes/{name}'
    t = io.open(p, encoding='utf-8').read()
    parts = t.split(MARK)
    # parts[0] 是亮色块前的内容；每个 MARK 出现处插入对应变量
    inserts = []
    if light: inserts.append(block(*light))
    if dark: inserts.append(block(*dark))
    if len(parts) - 1 < len(inserts):
        print(f'{name}: 锚点不足 ({len(parts)-1} < {len(inserts)})，跳过')
        continue
    out = parts[0]
    for i, seg in enumerate(parts[1:]):
        if i < len(inserts):
            out += inserts[i] + MARK + seg
        else:
            out += MARK + seg
    io.open(p, 'w', encoding='utf-8', newline='\n').write(out)
    print(f'{name}: ok')
