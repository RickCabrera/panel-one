"""Simplifica los trazos de los SVG de la marca: aplana cada subtrazo a sus puntos finales y
aplica Douglas-Peucker (tolerancia 0.4 en unidades del viewBox), con coordenadas relativas a
un decimal. Uso: simplificar.py entrada.svg salida.svg"""
import re
import sys

TOL = 0.4


def tokens(d):
    return re.findall(r'[MLCZmlcz]|-?\d*\.?\d+(?:e-?\d+)?', d)


def subtrazos(d):
    t = tokens(d)
    i = 0
    cmd = None
    actual = []
    todos = []
    pos = (0.0, 0.0)
    while i < len(t):
        if re.match(r'[A-Za-z]', t[i]):
            cmd = t[i]
            i += 1
            if cmd in 'Zz':
                if actual:
                    todos.append(actual)
                actual = []
                continue
        n = {'M': 2, 'L': 2, 'C': 6, 'm': 2, 'l': 2, 'c': 6}[cmd]
        v = [float(x) for x in t[i:i + n]]
        i += n
        if cmd.islower():
            x, y = pos[0] + v[-2], pos[1] + v[-1]
        else:
            x, y = v[-2], v[-1]
        if cmd in 'Mm':
            if actual:
                todos.append(actual)
            actual = [(x, y)]
            cmd = 'L' if cmd == 'M' else 'l'
        else:
            actual.append((x, y))
        pos = (x, y)
    if actual:
        todos.append(actual)
    return todos


def dp(p, tol):
    if len(p) < 3:
        return p
    (x1, y1), (x2, y2) = p[0], p[-1]
    dx, dy = x2 - x1, y2 - y1
    largo = (dx * dx + dy * dy) ** 0.5
    peor, idx = -1.0, 0
    for k in range(1, len(p) - 1):
        x, y = p[k]
        dist = abs(dy * x - dx * y + x2 * y1 - y2 * x1) / largo if largo else ((x - x1) ** 2 + (y - y1) ** 2) ** 0.5
        if dist > peor:
            peor, idx = dist, k
    if peor <= tol:
        return [p[0], p[-1]]
    return dp(p[: idx + 1], tol)[:-1] + dp(p[idx:], tol)


def cerrado(p, tol):
    # Parte el anillo en dos mitades para que Douglas-Peucker no colapse un trazo cerrado.
    if len(p) < 4:
        return p
    m = len(p) // 2
    a = dp(p[: m + 1], tol)
    b = dp(p[m:] + [p[0]], tol)
    return a[:-1] + b[:-1]


def num(v):
    s = f'{v:.1f}'
    if s == '-0.0':
        s = '0'
    if s.endswith('.0'):
        s = s[:-2]
    return s


def escribir(subs):
    partes = []
    pos = (0.0, 0.0)
    for s in subs:
        s = cerrado(s, TOL)
        if len(s) < 3:
            continue
        x0, y0 = round(s[0][0], 1), round(s[0][1], 1)
        partes.append(f'M{num(x0)} {num(y0)}l')
        pos = (x0, y0)
        rel = []
        for x, y in s[1:]:
            x, y = round(x, 1), round(y, 1)
            rel.append(f'{num(x - pos[0])} {num(y - pos[1])}')
            pos = (x, y)
        partes.append(' '.join(rel).replace(' -', '-') + 'z')
    return ''.join(partes)


entrada, salida = sys.argv[1], sys.argv[2]
svg = open(entrada).read()
svg = re.sub(r'\sd="([^"]*)"', lambda m: f' d="{escribir(subtrazos(m.group(1)))}"', svg)
open(salida, 'w').write(svg)
