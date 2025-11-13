# Guía de Activación del Pixel - Español

Basado en la documentación oficial de Shopify y mejores prácticas.

## 🔴 Problema: Pixel Aparece como "Desconectado"

### Razones Principales:

1. **No se ha ejecutado la mutación `webPixelCreate`**
   - Aunque la extensión esté desplegada con `shopify app dev`, el pixel NO se crea hasta ejecutar la mutación GraphQL
   - `shopify app dev` conecta la extensión a tu dev store, pero el pixel no se registra en la tienda

2. **Falta de permisos (scopes)**
   - Necesitas: `write_pixels` y `read_customer_events`
   - Sin estos scopes, no puedes crear ni activar el pixel

3. **El pixel no está registrado en la tienda**
   - Hasta ejecutar `webPixelCreate`, el pixel solo existe como código pero no como recurso activo

## ✅ Solución Implementada

### 1. Scopes Agregados ✅

En `shopify.app.toml`:
```toml
[access_scopes]
scopes = "read_orders,write_files,write_products,write_pixels,read_customer_events,write_script_tags"
```

**Importante**: Si acabas de agregar `read_customer_events`, necesitas:
- Reiniciar `shopify app dev` para que se apliquen los scopes
- Aceptar los nuevos permisos en Shopify Admin

### 2. Auto-Connect Implementado ✅

En `app/routes/app._index.tsx`:
- Se ejecuta automáticamente al cargar la app
- Intenta crear el pixel con `webPixelCreate`
- Logs mejorados para debugging

### 3. Página de Conexión Manual ✅

En `app/routes/app.connect-pixel.tsx`:
- Botón "Connect Pixel" para crear manualmente
- Muestra estado del pixel
- Muestra configuración actual
- Botón "Update Settings" para actualizar

## 📋 Pasos para Activar el Pixel

### Paso 1: Verificar Scopes

1. Abre `shopify.app.toml`
2. Verifica que tienes:
   ```toml
   scopes = "...,write_pixels,read_customer_events,..."
   ```
3. Si acabas de agregar `read_customer_events`:
   - Reinicia `shopify app dev`
   - Ve a tu app en Shopify Admin
   - Acepta los nuevos permisos

### Paso 2: Conectar el Pixel

**Opción A: Auto-Connect (Automático)**
- Simplemente carga la app (`/app`)
- El pixel se conecta automáticamente
- Revisa los logs en la consola del servidor

**Opción B: Manual**
1. Visita `/app/connect-pixel`
2. Haz clic en "Connect Pixel"
3. Espera el mensaje de éxito

### Paso 3: Verificar Activación

1. Ve a **Shopify Admin → Settings → Customer Events**
2. Busca tu app en la lista de "App pixels"
3. Debería mostrar estado "Connected" (Conectado) ✅

### Paso 4: Verificar que el Pixel Dispara Eventos

1. Abre tu tienda de desarrollo
2. Haz clic derecho → Inspeccionar → Console
3. Visita una página de producto
4. Deberías ver logs como:
   ```
   [A/B Test Pixel] Initialized
   [A/B Test Pixel] Product viewed
   [A/B Test Pixel] Fetching test state...
   ```

## 🔍 Debugging

### Si el Pixel No se Conecta:

1. **Revisa los logs del servidor**:
   ```bash
   # Deberías ver:
   [app._index] Attempting to auto-connect web pixel...
   [app._index] ✅ Pixel created successfully: gid://shopify/WebPixel/...
   ```

2. **Revisa errores en `/app/connect-pixel`**:
   - Si hay errores, se mostrarán en la página
   - Revisa el código de error y mensaje

3. **Verifica scopes**:
   ```bash
   shopify app env show
   ```
   Debería mostrar `write_pixels` y `read_customer_events`

4. **Verifica en Shopify Admin**:
   - Settings → Customer Events
   - Busca tu pixel en la lista
   - Si aparece pero está "Disconnected", haz clic en "Connect"

### Si No Recibes Eventos:

1. **Verifica suscripciones en el código del pixel**:
   ```typescript
   // extensions/ab-test-pixel/src/index.ts
   analytics.subscribe('product_viewed', async event => {
     // ...
   });
   ```

2. **Verifica que el pixel esté "Connected"**:
   - Shopify Admin → Customer Events
   - Estado debe ser "Connected"

3. **Verifica que hayas desplegado**:
   - Desarrollo: `shopify app dev` debe estar corriendo
   - Producción: `shopify app deploy`

4. **Verifica Customer Privacy**:
   - Shopify Admin → Settings → Customer Privacy
   - Cookie banner debe estar activado

## 📝 Configuración del Pixel

### Settings Requeridos:

```typescript
{
  app_url: "https://shopify-txl.dreamshot.io", // Tu app URL
  enabled: "true",                              // Habilitar pixel
  debug: "true"                                 // Modo debug (desarrollo)
}
```

### Estructura de la Mutación:

```graphql
mutation webPixelCreate($webPixel: WebPixelInput!) {
  webPixelCreate(webPixel: $webPixel) {
    userErrors {
      code
      field
      message
    }
    webPixel {
      id
      settings
    }
  }
}
```

## ⚠️ Errores Comunes

### Error: "PIXEL_ALREADY_EXISTS"
- **Significado**: El pixel ya existe
- **Solución**: Es normal, el pixel debería estar conectado. Refresca la página de conexión.

### Error: "Missing required scope"
- **Significado**: Falta el scope `read_customer_events` o `write_pixels`
- **Solución**: Agrega los scopes en `shopify.app.toml` y reinicia `shopify app dev`

### Error: "Invalid settings"
- **Significado**: Los settings no coinciden con `shopify.extension.toml`
- **Solución**: Verifica que los campos en `settings` coincidan con los definidos en la extensión

## 🎯 Checklist Final

- [ ] Scopes agregados: `write_pixels`, `read_customer_events`
- [ ] `shopify app dev` reiniciado después de agregar scopes
- [ ] Permisos aceptados en Shopify Admin
- [ ] Pixel creado con `webPixelCreate` (auto o manual)
- [ ] Pixel aparece como "Connected" en Customer Events
- [ ] Logs del pixel aparecen en la consola del navegador
- [ ] Eventos se registran en la base de datos

## 📚 Referencias

- [Shopify Web Pixel Docs](https://shopify.dev/docs/apps/build/marketing-analytics/build-web-pixels)
- [GraphQL webPixelCreate API](https://shopify.dev/docs/api/admin-graphql/latest/mutations/webPixelCreate)
