# Server-Side Test Assignment

## Nueva Arquitectura

### Antes (Cliente busca test)
```
Pixel → GET /api/rotation-state → Busca test
Pixel → POST /track → Envía testId + activeCase
```

### Ahora (Servidor asigna test)
```
Pixel → POST /track → Solo envía productId
Servidor → Busca test activo para productId
Servidor → Asigna testId + activeCase automáticamente
```

## Cambios Aplicados

### 1. Schema Actualizado
- `testId` ahora es `String?` (nullable)
- `activeCase` ahora es `String?` (nullable)
- Relación con `ABTest` es opcional

### 2. Pixel Simplificado
- No necesita buscar test state antes de trackear
- Siempre trackea eventos directamente
- Solo envía: `sessionId`, `eventType`, `productId`, `variantId`

### 3. Servidor Asigna Test
- Busca test activo para `productId`
- Si encuentra → Asigna `testId` y `activeCase`
- Si no encuentra → Guarda evento con `testId: null`, `activeCase: null`

## Comportamiento

### Con Test Activo
```
Evento → testId: "cmhxr8jri000e9k88ke4kubm5", activeCase: "BASE"
```

### Sin Test Activo
```
Evento → testId: null, activeCase: null
```

## Beneficios

✅ **Pixel más simple** - No necesita lógica de test state
✅ **Siempre trackea** - Funciona incluso sin tests activos
✅ **Asignación automática** - Servidor determina el test
✅ **Backward compatible** - Acepta testId/activeCase si se envían

## Próximos Pasos

1. **Migrar base de datos**: `bun run prisma db push`
2. **Regenerar Prisma**: `bun run prisma generate`
3. **Redesplegar pixel**
4. **Probar**: Visitar página sin test activo → Evento se guarda con testId: null
