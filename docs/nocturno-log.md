# Log del modo autónomo

Este archivo es el **único canal entre sesiones nocturnas**. La sesión que viene detrás
no recuerda nada de la anterior: no vio su razonamiento, ni sus dudas, ni lo que
descubrió a medio camino. Sólo lee esto.

Escribe para alguien que llega en frío.

## Reglas de este archivo

1. **Una entrada por tarea**, al final del archivo (las nuevas abajo).
2. **La entrada se commitea DENTRO DE LA RAMA de la tarea**, antes del push y del PR, y
   viaja en el PR como un archivo más del entregable. No después del merge: el vigilante
   mata la ventana en cuanto la tarea cierra, y la nota escrita después es la nota que no
   se escribe. En un repo hermano que corre este mismo protocolo, nueve sesiones seguidas
   cerraron sin dejar nota por eso.
3. **Excepción, una sola:** la entrada de una tarea **SALTADA** va commiteada y pusheada
   **directo a main**. La rama se va a borrar; si la nota se queda en ella, la sesión
   siguiente no ve el salto y vuelve a tomar la misma tarea.
4. La palabra **SALTADA** en el encabezado es lo que lee la sesión siguiente para no
   volver a tomar esa tarea. Escríbela tal cual, en mayúsculas.
5. Lo que no sirve: "implementé F1-030, todo bien". Lo que sirve: por qué elegiste esa
   opción y no la otra, qué te tomó más tiempo del que valía, qué está a medias, qué
   supusiste sin poder confirmarlo, y qué harías distinto.
6. Los hallazgos sobre el esquema de SoftRestaurant **no van aquí**: van a
   `docs/esquema-sr.md`, que es donde alguien los va a buscar. Aquí sólo la referencia.

## Formato

```markdown
## AAAA-MM-DD HH:MM — F1-0XX · Título corto de la tarea
**Estado:** CERRADA (PR #N, mergeada) | SALTADA (razón en una línea)

**Qué quedó hecho.** Lo que de verdad funciona al terminar, no lo que se intentó.

**Decisiones que tomé y por qué.** Sobre todo las que otra sesión podría revertir sin
saber que ya se pensaron. Incluye las marcadas `# DECISION PROVISIONAL (nocturno):`
en el código, con su ruta y línea.

**Trampas que encontré.** Lo que costó tiempo y no era obvio: una columna del POS que
significaba otra cosa, un test que pasaba por el motivo equivocado, una herramienta que
falló en silencio. Es lo más valioso que puede tener esta nota.

**Qué quedó abierto.** A medias, pendiente, o que descubrí que hace falta y no era parte
de esta tarea. Si es una tarea nueva, dilo y di dónde debería ir en la cola.

**Qué haría distinto.** Para quien tome la siguiente.
```

---

<!-- Las entradas empiezan aquí. La primera sesión nocturna escribe debajo de esta línea. -->

## 2026-09-20 20:25 — F1-001 · Monorepo y tooling base
**Estado:** CERRADA PARCIAL (corte por máquina, no por tiempo) — falta verificar
`docker compose up`; el resto queda en **F1-001b**, que está en **Diurnas**.

> Sesión interactiva con Ricardo presente, no nocturna. Se retomó después de que un
> reinicio mató la sesión original con todo el andamiaje en staging en `feat/F1-001`.
> Por decisión explícita de Ricardo (andamiaje, él presente): sin pase de revisor y merge
> sin esperar al CI, en cuanto pasaron los checks locales. No es precedente para el bucle.

**Qué quedó hecho.** Carpetas `/agent`, `/api`, `/web`, `/infra` con su tooling:
`.editorconfig`, `.gitignore` por carpeta, ESLint + Prettier en `/api` y `/web`,
`Directory.Build.props` con nullable en `/agent`, README raíz, `infra/docker-compose.yml`
con Postgres 16 vacío. Los carriles `api`, `web` y `agent` de `.github/workflows/ci.yml`
quedaron encendidos sin sus pasos de test (cada uno anota la tarea que lo enciende:
F1-011, F1-041, F1-021).

Verificado en local, sobre el commit de la rama:
- `npm run dev` en `/api`: Nest arranca, `GET http://localhost:3000/` → 200
  `{"servicio":"monitor-api","estado":"arriba"}`.
- `npm run dev` en `/web`: Vite arranca, `GET http://localhost:5173/` → 200.
- `dotnet build --configuration Release` en `/agent`: 0 advertencias, 0 errores.
- `/api`: lint limpio, typecheck limpio, jest 1/1. `/web`: lint limpio, build (tsc + vite)
  limpio, vitest 1/1. `prettier --check .` limpio.
- `docker compose config -q` en `/infra`: válido.

**Por qué el corte.** Esta máquina no tiene la virtualización habilitada en la BIOS, así
que Docker Desktop no puede arrancar el engine: `docker compose config` valida, pero
`docker compose up` no se puede correr. Lo único del "Listo cuando" que no se verificó es
"`docker compose up` en `/infra` levanta postgres vacío".

**Trampas que encontré.** `npm ci` avisa de postinstall bloqueados por `allow-scripts`
(`unrs-resolver`); no afecta lint/build/test hoy, pero si algo de ESLint empieza a fallar
raro en otra máquina, empieza por ahí.

**Qué quedó abierto.** **F1-001b** (Diurnas): correr `docker compose up -d` en `/infra` en
una máquina con virtualización y confirmar que Postgres queda healthy y vacío. Es diurna
porque depende del hardware de la máquina, no de código. **Ojo:** F1-010 (`prisma migrate
dev`) necesita un Postgres corriendo; si la máquina sigue sin virtualización, esa tarea
también se va a topar con esto (alternativa: Postgres nativo de Windows en el 5432 con las
credenciales de `infra/.env.example`).

**Qué haría distinto.** Commitear el andamiaje en cuanto compila, aunque falten checks:
un reinicio con todo en staging es trabajo que sólo sobrevivió de milagro.
