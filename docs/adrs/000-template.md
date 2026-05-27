# NNN — [Título corto y descriptivo de la decisión]

**Status:** Proposed | Accepted | Deprecated | Superseded by ADR-XXX
**Date:** YYYY-MM-DD
**Authors:** [Tu nombre]
**Tags:** [opcional: domain, infra, security, data, etc.]

## Context

[2-4 párrafos. Qué problema técnico estás resolviendo. Qué restricciones existen
(técnicas, de negocio, regulatorias, de equipo). Qué fuerzas están en juego.
Información suficiente para que alguien que llega nuevo entienda la situación
sin tener que preguntar.]

## Decision

[1-2 párrafos. La decisión tomada, expresada con claridad.
"Vamos a hacer X" — directo, sin ambigüedad. Si hay condiciones, listalas.]

## Alternatives Considered

### Alternative A: [Nombre]
- **Cómo funciona:** [breve descripción]
- **Pros:** [lista corta]
- **Cons:** [lista corta]
- **Por qué no elegida:** [razón concreta]

### Alternative B: [Nombre]
[mismo formato]

### Alternative C: [Nombre]
[mismo formato]

## Trade-off Matrix (opcional, cuando hay >3 alternativas)

| Criterio | A | B | C |
|----------|---|---|---|
| Performance | Alto | Medio | Alto |
| Complejidad | Bajo | Medio | Alto |
| Lock-in | Alto | Bajo | Medio |

## Consequences

### Positive
- [Lo que ganamos]
- [Capacidades nuevas habilitadas]

### Negative
- [Lo que perdemos]
- [Costos asumidos]
- [Deuda técnica creada explícitamente]

### Risks
- [Riesgo + mitigación planeada]

## When to Revisit

[Condiciones concretas que disparan reconsiderar. Ejemplos:
- "Si la latencia p99 supera 500ms"
- "Si llegamos a >10 providers"
- "Si el equipo crece a >5 backend engineers"]

## References

- [Artículos, papers, docs que informaron la decisión]
- [ADRs relacionados: ADR-XXX]
