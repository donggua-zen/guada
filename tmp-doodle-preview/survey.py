import io, re, glob
for f in sorted(glob.glob('frontend/public/themes/*.css')):
    t = io.open(f, encoding='utf-8').read()
    name = f.split('/')[-1]
    out = [name]
    for var in ['--color-surface:', '--color-bg:', '--color-surface-border:', '--color-sidebar-bg:']:
        vals = [v.strip() for v in re.findall(re.escape(var) + r'\s*([^;]+);', t)]
        out.append(var.replace('--color-','').replace(':','') + '=' + ' | '.join(vals))
    print(' ; '.join(out))
