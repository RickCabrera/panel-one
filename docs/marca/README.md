# Marca Yo Controlo

Fuente de la marca del producto (UI-02, 5-nov-2026). Antes se llamaba «Monitor SoftRestaurant»;
el agente de Windows sigue siendo `ArkonAgente` por compatibilidad, y SoftRestaurant se sigue
nombrando donde se habla del POS.

![Cómo se ven los logos](preview.png)

## Archivos

El logo es un wordmark en mayúsculas, «YO CONTROLO», de letra display gruesa, con la C como un
ojo con rayos (estilo grabado o sello). **No se escribe con una fuente**: siempre son estos SVG.
Cada SVG trae sus trazos con `class="letras"`, `"ojo"` y `"pupila"`.

| Archivo | Para qué |
| --- | --- |
| `yocontrolo-oscuro.svg` | Logotipo todo arena, sobre fondos morados u oscuros. Es el de la barra lateral y el login. |
| `yocontrolo-oscuro-fondo.svg` | El mismo, con su fondo morado (para correos, documentos o redes). |
| `yocontrolo-claro.svg` | Letras morado de marca y ojo violeta, sobre fondos claros (README, documentos). |
| `isotipo-oscuro.svg` / `isotipo-claro.svg` | Sólo el ojo-C, sin fondo. El riel de iconos del lateral, la pantalla de carga y la cabecera en el teléfono. |
| `isotipo-app.svg` | Ícono cuadrado: el ojo arena sobre morado. Es el favicon y la base de los íconos de la PWA. |
| `simplificar.py` | Cómo se aligeraron las copias de `web/public/marca/` (de ~93 kB a ~5 kB): aplana cada trazo y le aplica Douglas-Peucker con tolerancia 0.4 del viewBox, sin cambio visible. Los SVG de esta carpeta son la fuente a precisión completa. `python3 simplificar.py entrada.svg salida.svg`. |
| `trazar.py`, `vector.py` | Cómo se vectorizó el logo desde la imagen original (OpenCV + potrace). El PNG original de 2.6 MB no está en el repo. |
| `preview.png` | Los logos sobre sus fondos, para verlos de un vistazo. |

En el panel viven copias en `web/public/marca/` (las sirve el web; el service worker las guarda
para abrir sin red) y el componente es `web/src/marca/Marca.tsx` (`Logotipo`, `Isotipo`, con
variante `oscuro`, `claro` o `auto` según el tema).

### Íconos del navegador y de la PWA

`web/public/favicon.svg` es `isotipo-app.svg`. Los PNG (`web/public/iconos/`: favicon de 32,
192, 512, maskable de 512 y apple-touch de 180) se rasterizan con Chromium desde los SVG:

```
cd web && node scripts/iconos-pwa.mjs   # necesita playwright con Chromium en la máquina
```

El maskable y el apple-touch van a sangre completa (fondo morado y el ojo centrado dentro de la
zona segura del 80 %); los de 192 y 512 son el ícono redondeado tal cual.

## Colores

Todo color del panel vive en `web/src/tema/paleta.ts` (la regla de lint `tema/sin-colores`
prohíbe escribirlos en otro lado) y `paleta.test.ts` mide el contraste WCAG de cada pareja en los
dos temas. Valores finales:

### Marca

| Nombre | Hex | Uso |
| --- | --- | --- |
| Morado de marca | `#2C1533` | Barra lateral (en los dos temas), cabecera del login, ícono, `theme-color`, texto principal en claro. |
| Arena | `#E3CBA8` | El logo sobre morado; acento secundario (muesca del ítem activo, foco sobre el lateral, avatar). |
| Violeta interactivo | `#6D3FC0` | Primario: botones, ítem activo, enlaces, interruptores; franja de los correos por defecto (factura, cancelación, folios). Acento de fábrica (`ACENTO_POR_DEFECTO`) y la clave `morado` de Plataforma › Ajustes. Hover: `brightness-110` (≈ `#7E52D1`). |

Por qué `#6D3FC0` y no otro: con texto blanco da **6.7:1**, y como texto pasa 4.5:1 sobre todas
las superficies claras sin ajuste. Sobre el morado `#2C1533` el relleno queda en 2.5:1, así que
el ítem activo del lateral lleva además una muesca arena (y el foco del lateral es arena) para
no depender sólo de ese relleno. Por lo mismo, lo elegido en los controles segmentados (periodo,
tema, pestañas) lleva el borde del acento, que da ≥ 3:1 contra su carril en los dos temas
(`paleta.test.ts`). En oscuro, el texto y los bordes del acento se aclaran solos
(`derivarAcento`): enlaces `#AF95DC`, bordes y serie 1 de las gráficas `#926FD0`.

### Tema claro

| Token | Hex |
| --- | --- |
| fondo | `#F7F5FB` |
| superficie | `#FFFFFF` |
| realce / realce-fuerte | `#F1EDF7` / `#E5DEEF` |
| línea suave / línea / línea fuerte | `#F1EDF7` / `#E5DEEF` / `#CDC2DD` |
| tinta / medio / suave / tenue | `#2C1533` / `#3E2A4B` / `#54426A` / `#63527A` (tenue: 5.3:1 sobre realce-fuerte) |

### Tema oscuro (morado, no gris ni azul marino)

| Token | Hex |
| --- | --- |
| fondo | `#1E0E24` |
| superficie | `#2C1533` |
| realce / realce-fuerte | `#3A1F45` / `#4A2B58` |
| línea suave / línea / línea fuerte | `#34193D` / `#4A2B58` / `#6A4A7A` |
| tinta / medio / suave / tenue | `#F6F0F4` / `#EBE0EA` / `#D6C6DA` / `#BEA9C5` (tenue: 5.4:1 sobre realce-fuerte) |

### Barra lateral (igual en los dos temas)

| Token | Hex |
| --- | --- |
| lateral | `#2C1533` |
| lateral-borde | `#40264C` |
| lateral-realce (hover) | `#3C2248` |
| lateral-tinta (texto) | `#F4ECE4` |
| lateral-tenue (encabezados) | `#C3AFC8` |

### Estados y gráficas

Verde (en línea, éxito), ámbar (alerta) y rojo (error) se quedan semánticos, no siguen a la
marca. Únicos ajustes: el ámbar del semáforo y de la serie 3 en claro bajó a `#C96D05` (el
anterior quedaba en 2.9:1 sobre el fondo lavanda), y la serie 2 pasó de índigo a verde azulado
(`#0D8A7F` claro, `#2DD4BF` oscuro) para no confundirse con el violeta de la serie 1.

### Hero y profundidad (UI-05, v3)

El hero del Inicio (la venta del periodo), el MRR de Plataforma y el fondo del login son
**siempre** el morado de marca con un degradado hacia el violeta, como las secciones moradas de
la landing. Sus tokens no siguen al tema de las superficies; `paleta.test.ts` mide su texto
contra los **dos** extremos del degradado (así cualquier punto intermedio pasa).

| Token | Claro | Oscuro | Uso |
| --- | --- | --- | --- |
| hero → hero-fin | `#2C1533` → `#4A2470` | `#3D1C4F` → `#241029` | El degradado (en oscuro sube un escalón para no perderse contra las tarjetas). |
| hero-borde | `#2C1533` | `#5A3570` | Contorno (en oscuro es lo que lo separa del fondo). |
| hero-tinta / hero-tenue | `#F6EEE6` / `#D3C0D9` | igual | Texto y texto secundario sobre el hero. |
| hero-cifra | `#EFD9B6` | igual | La cifra grande y la línea de la gráfica: el arena, un punto más claro. |
| hero-sube / hero-baja | `#8EE6B4` / `#FFB4AC` | igual | El cambio contra la base (siempre con flecha y signo en el texto). |
| hero-rejilla | `#FFFFFF1F` | igual | Rejilla de la gráfica dentro del hero. |
| brillo | `#6D3FC02E` | `#926FD040` | Halo violeta: hover de tarjetas, foco de campos. |
| resalte | `#FFFFFF` | `#FFFFFF14` | El filo de luz de 1 px arriba de cada tarjeta. |

Sombras (`index.css`): `shadow-tarjeta` (filo de luz + contacto + sombra larga y difusa),
`shadow-tarjeta-alta` (al pasar: la difusa se tiñe de violeta) y `shadow-hero`. Radios: tarjetas
`rounded-2xl`, controles `rounded-lg`, insignias `rounded-full`.

Movimiento, siempre con `motion-safe:` (o `prefiereMovimiento()` en JS): las tarjetas del Inicio
aparecen una tras otra al abrir (un solo momento), el punto del «en vivo» late, los esqueletos
destellan y las cifras cuentan del valor anterior al nuevo al refrescarse (en `bigint`, nunca
float; la primera vez se ven tal cual).

## Tipografía

- **Lilita One** (la display de la landing) sólo para el `h1` de cada vista (UI-05). Trae un
  solo peso: `font-synthesis: none` evita las negritas falsas.
- **Outfit** 600/700 para subtítulos (`h2`, `h3`, `font-titulo`) y el número de mesa.
- **Inter** 400–700 para todo lo demás. Las cifras de dinero grandes (KPI, hero) van en Inter
  semibold con cifras tabulares y `tracking-tight`: no bailan cuando cuentan.

Las tres empaquetadas con `@fontsource` (sólo el subconjunto latin y esos pesos; ver
`web/src/main.tsx`): la CSP del sitio es `font-src 'self'`.
