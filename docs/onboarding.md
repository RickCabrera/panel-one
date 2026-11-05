# Landing pública y onboarding (F2-147)

Tres piezas: la **landing** del producto (pública, estática), el **alta guiada** de una empresa
(sólo admin_global) y la **lista de arranque** que se ve en Inicio hasta que la empresa recibe
datos. Nada de esto toca SoftRestaurant.

## 1. Alta guiada — `POST /empresas/alta-guiada`

- Sólo **admin_global** (ruta y servicio; el helper de scope, además, truena con un scope de
  empresa).
- Crea en **una sola transacción** (`ScopedPrismaService.altaEnTransaccion`): la empresa, de 1 a
  20 sucursales **con su API key ya generada** (en la base sólo el hash), y opcionalmente su primer
  `admin_empresa`. Si algo falla —el email del administrador ya existe (409), por ejemplo— no queda
  **nada**: ni la empresa ni sus sucursales.
- Dos sucursales con el mismo nombre (sin distinguir mayúsculas ni espacios) son 400.
- La respuesta trae las keys **en claro, una sola vez**, con `Cache-Control: no-store`. La
  contraseña del administrador no vuelve: la tiene quien la mandó.
- Auditoría: `empresa.alta_guiada` + `sucursal.crear` y `sucursal.rotar_api_key` por sucursal +
  `usuario.crear`. Sin keys ni hashes.
- En la web (`/admin/alta`, botón en Administración › Empresas): cinco pasos (empresa,
  sucursales, administrador, revisar, listo). La contraseña inicial se propone con
  `crypto.getRandomValues` (16 caracteres sin 0/O/1/l/I). El último paso muestra las keys con
  su botón de copiar, la contraseña, la guía del agente (`/ayuda/agente`) y la lista de
  arranque, y no deja terminar sin marcar "ya copié las keys". Las keys viven sólo en el estado
  del componente: sin `useMutation`, sin localStorage, y el service worker nunca toca `/api/`
  (test en `pwa/sw-logica.test.ts`).

## 2. Lista de arranque — `GET /empresas/:id/arranque`

- admin_global (cualquier empresa) y admin_empresa (la suya; otra = 404, igual que una que no
  existe). El visor recibe 403 por ruta, en cualquier empresa.
- **Se deduce, no se guarda.** Cinco pasos sobre las sucursales ACTIVAS:
  1. `sucursales`: hay al menos una.
  2. `llaves`: todas tienen `api_key_hash`.
  3. `agente`: todas tienen fila en `agente_contacto` (la escribe cualquier lote aceptado de
     `POST /ingesta/eventos`, incluido uno de sólo heartbeat).
  4. `ventas`: todas tienen al menos un cheque.
  5. `usuario`: hay un `admin_empresa` activo.
  Una sucursal nueva sin key reabre la lista; una dada de baja no la bloquea.
- **El seed:** sus empresas tienen ventas pero ninguna key ni contacto de agente. La lista las
  muestra con `llaves` y `agente` pendientes y `ventas` hecho, y el detalle de ventas lo explica
  ("hay ventas registradas, pero de sucursales cuyo agente nunca se ha reportado: son datos de
  demostración o de un agente anterior"). No se tocó el seed de contactos a propósito: movería
  `GET /agentes/estado` y las alertas de sucursal sin contacto.
- En la web: tarjeta en Inicio para admins mientras `completo` sea falso (se relee cada 20 s);
  cada paso pendiente dice en qué sucursales falta y a dónde ir.
- `descargaAgente`: la URL de `AGENTE_URL_DESCARGA` (https, validada al arrancar). Sin ella, la
  UI dice que el instalador lo entrega soporte. F2-143 la cambiará por una URL firmada.

## 3. Landing — `web/landing/` → `web/dist-landing/`

- Build **aparte** de la SPA (`vite.landing.config.ts`): HTML + CSS a mano + un módulo chico para
  el formulario, los planes y la demo animada (`src/landing/`). No entra al precache de la PWA ni al tope de `check:bundle`.
  `npm run build` construye las dos. Local: `npm run dev:landing` (puerto 5174, con proxy a
  `/api`).
- **Marca Yo Controlo (UI-03):** logo en `web/landing/marca/` (copias propias de la landing; el
  panel lleva las suyas en `web/public/marca/`), paleta morado #2C1533 / arena #E3CBA8 / violeta
  #6D3FC0, Lilita One para títulos y Atkinson Hyperlegible para texto, empaquetadas desde
  `@fontsource` (la CSP dice `font-src 'self'`). Los SVG del logo se adelgazaron (de ~93 kB a
  ~6 kB) con una simplificación Douglas-Peucker de 0.4 unidades sobre el trazo original.
- Secciones: hero con demo animada (el ojo del logo vigila la caja: caen tickets y sube la venta
  del día; la pupila sigue al puntero y parpadea; quieto con `prefers-reduced-motion`), qué ves
  (beneficios + **ilustraciones HTML/CSS** del celular y del monitor de mesas), "tu caja sigue
  igual" (solo lectura, sin internet, sin luz), cómo funciona en 3 pasos, planes, preguntas
  frecuentes y contacto. Las ilustraciones van `aria-hidden` y con el pie "Ilustración con datos de
  demostración": no son capturas reales.
- **Planes sin precio (UI-03):** Esencial (1 sucursal), Completo (hasta 5, propuesta) y Cadena
  (ilimitadas); cada uno dice "Cotiza" y su botón "Quiero este plan" lleva al formulario con el
  plan preseleccionado (`?plan=completo#contacto`, funciona sin JS). La cifra y el tope de
  sucursales los decide Ricardo (D-07); un test y `check:landing` fijan que no se publica una cifra.
- `URL_PANEL` (al construir): a dónde lleva "Entrar al panel". Por defecto `/login`.
- `URL_SITIO` (al construir, UI-03): el origen público (`https://…`) para la `og:image` absoluta
  (`og.png`, 1200×630). Sin ella queda `/og.png`, que algunos lectores de Open Graph no toman.
- **Formulario de contacto** → `POST /api/publico/contacto` (público, 3/min y 20/h por IP con dos
  throttlers propios). Sale por el `PuertoCorreo` (Brevo real / falso) al buzón de
  `CONTACTO_DESTINO`, con todo lo del visitante escapado (y sin saltos de línea en el asunto). No
  se guarda nada en nuestra base. El campo `sitio` es una trampa para bots: con algo, 202 y no sale
  nada. El plan elegido (UI-03) no es un campo del contrato (`ContactoDto` rechaza campos
  desconocidos): viaja como primera línea del mensaje, "Plan de interés: Completo.", y el tope de
  2000 caracteres cuenta los dos. Sin `CONTACTO_DESTINO`: fuera de producción, `contacto@monitor.local`; en producción, 503
  (DECISION PROVISIONAL: no tumbar el arranque del api por la landing).

### Cómo se mide

- `npm run check:landing` (CI): lang, título, description, viewport, un `<h1>`, labels, títulos de
  las ilustraciones, secciones, `robots.txt`, nada de otro origen, Open Graph con `og.png` de
  1200×630 (< 120 kB), planes sin cifras, ningún `style=""` (la CSP lo bloquearía) y peso < 75 kB
  gzip sin `og.png` (UI-03 lo subió de 40: ~44 kB son las fuentes, que no comprimen).
- `npm run lighthouse:landing` (LOCAL, necesita Chrome y red para bajar `lighthouse@13.5.0`):
  levanta `vite preview` del build y exige > 90 en las cuatro categorías. Resultado del 23/09/2026
  en la máquina de desarrollo, perfil móvil: **Performance 100 · Accessibility 100 · Best
  Practices 100 · SEO 100**. En Windows, chrome-launcher falla al borrar su perfil temporal
  DESPUÉS de guardar el reporte; el script lo tolera si el reporte está completo y sin
  `runtimeError`.
- **Cronómetro del asistente** (`AltaGuiada.test.tsx`): un modelo de captura humana conservador
  (5 s por campo, 0.4 s por carácter, 2 s por clic, 6 s por desplegable, 30 s de lectura por
  pantalla) aplicado a las interacciones que el test hace de verdad (envoltorios de `userEvent`).
  Para una empresa con 3 sucursales y su administrador: 7 campos, 96 caracteres, 12 clics, 2
  desplegables, 6 pantallas → **≈ 289 s** de captura, tope 600 s. Es una estimación, no una
  medición con una persona: ésa va con el piloto (F1-091).

## Pendiente de validación real (F2-191)

- Mandar un contacto real por Brevo al buzón de `CONTACTO_DESTINO`.
- `AGENTE_URL_DESCARGA` con el zip real del instalador.
- Lighthouse contra el dominio real, detrás de Caddy (F1-002).
