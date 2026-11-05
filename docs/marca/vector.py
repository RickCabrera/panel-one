import sys, numpy as np, cv2, potrace
d = sys.argv[1]
mask = np.load(d + '/mascara.npy')
n, lbl, stats, _ = cv2.connectedComponentsWithStats(mask, 8)
# clasificar: el componente más alto es el ojo-C; el que está dentro de él, la pupila
alto = max(range(1, n), key=lambda i: stats[i, cv2.CC_STAT_HEIGHT])
xC, yC, wC, hC = stats[alto][:4]
pupila = [i for i in range(1, n) if i != alto and stats[i][0] > xC and stats[i][0] + stats[i][2] < xC + wC]
letras = [i for i in range(1, n) if i != alto and i not in pupila]
S = 4  # sobremuestreo para curvas suaves
def trazar(ids):
    m = np.isin(lbl, ids).astype(np.float32)
    big = cv2.resize(m, None, fx=S, fy=S, interpolation=cv2.INTER_CUBIC)
    big = cv2.GaussianBlur(big, (0, 0), S * 0.6)
    bm = big > 0.5
    path = potrace.Bitmap(~bm).trace(turdsize=40, alphamax=1.0, opticurve=True, opttolerance=0.5)
    parts = []
    for c in path:
        st = c.start_point
        s = f"M{st.x/S:.1f} {st.y/S:.1f}"
        for seg in c.segments:
            if seg.is_corner:
                s += f"L{seg.c.x/S:.1f} {seg.c.y/S:.1f}L{seg.end_point.x/S:.1f} {seg.end_point.y/S:.1f}"
            else:
                s += (f"C{seg.c1.x/S:.1f} {seg.c1.y/S:.1f} {seg.c2.x/S:.1f} {seg.c2.y/S:.1f} "
                      f"{seg.end_point.x/S:.1f} {seg.end_point.y/S:.1f}")
        parts.append(s + "Z")
    return ' '.join(parts)
ys, xs = np.nonzero(mask)
x0, x1, y0, y1 = xs.min(), xs.max(), ys.min(), ys.max()
pad = 24
open(d + '/partes.txt', 'w').write('\n'.join([
    f"{x0-pad} {y0-pad} {x1-x0+2*pad} {y1-y0+2*pad}",
    f"{xC-pad} {yC-pad} {wC+2*pad} {hC+2*pad}",
    trazar(letras), trazar([alto]), trazar(pupila)]))
print('ok', len(letras), 'letras; ojo', alto, 'pupila', pupila)
