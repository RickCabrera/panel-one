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
