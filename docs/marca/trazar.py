import sys, numpy as np, cv2, potrace
src, out = sys.argv[1], sys.argv[2]
img = cv2.imread(src)
lab = cv2.cvtColor(img, cv2.COLOR_BGR2LAB)
L = lab[:, :, 0].astype(np.float32)
# crema vs morado: umbral por luminosidad, suavizado para quitar la textura de papel
Lb = cv2.GaussianBlur(L, (0, 0), 2.2)
mask = (Lb > 110).astype(np.uint8)
k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5))
mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, k, iterations=2)
mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, k, iterations=1)
# quitar motas sueltas
n, lbl, stats, _ = cv2.connectedComponentsWithStats(mask, 8)
keep = np.zeros_like(mask)
for i in range(1, n):
    if stats[i, cv2.CC_STAT_AREA] > 400: keep[lbl == i] = 1
mask = keep
ys, xs = np.nonzero(mask); x0, x1, y0, y1 = xs.min(), xs.max(), ys.min(), ys.max()
print('bbox', x0, x1, y0, y1)
cv2.imwrite(out + '/mascara.png', mask * 255)
np.save(out + '/mascara.npy', mask)
# componentes con su caja, para separar el ojo-C de las letras
n, lbl, stats, cent = cv2.connectedComponentsWithStats(mask, 8)
for i in range(1, n):
    x, y, w, h, a = stats[i]; print(i, x, y, w, h, a)
