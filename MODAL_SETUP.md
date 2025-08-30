# Configuración del Modal AI Image Generation

## ✅ Solución Implementada

Ahora tienes **2 extensiones separadas** que trabajan juntas:

### 1. **Admin Block Extension** (`model-swap`)

- **Archivo**: `extensions/model-swap/src/ProductDetailsConfigurationExtension.tsx`
- **Target**: `admin.product-details.block.render`
- **Función**: Bloque inline en la página de producto con botón "🎨 Open AI Studio"

### 2. **Admin Action Extension** (`ai-image-modal`)

- **Archivo**: `extensions/ai-image-modal/src/AIImageModalExtension.tsx`
- **Target**: `admin.product-details.action.render`
- **Función**: Modal grande (80% viewport) para generar imágenes

## 🔄 Cómo Funciona

1. **En la página de producto** → Aparece el bloque con botón "Open AI Studio"
2. **Click en el botón** → `navigation.navigate('extension:ai-image-modal')`
3. **Se abre el modal** → Interfaz completa para seleccionar imagen + prompt + generar
4. **Close** → `close()` regresa a la página de producto

## 🚀 Para Ejecutar

```bash
cd /Users/javierjrueda/dev/ds-shopify
npm run dev
```

## 📝 Cambios Clave Realizados

### ✅ Arreglado

- ❌ **Error**: `Modal` no existe en admin extensions
- ✅ **Solución**: Usar Admin Action Extension (modal nativo de Shopify)

- ❌ **Error**: `multiline={3}` no válido en TextField
- ✅ **Solución**: Removido, usar TextField normal

- ❌ **Error**: API deprecated `product.images`
- ✅ **Solución**: Migrado a `product.media` con GraphQL fragment

- ❌ **Error**: No se puede mezclar block + action en misma extensión
- ✅ **Solución**: Extensiones separadas con navegación

### 🎯 Estructura Final

```
extensions/
├── model-swap/                    # Admin Block
│   ├── shopify.extension.toml
│   └── src/ProductDetailsConfigurationExtension.tsx
└── ai-image-modal/               # Admin Action (Modal)
    ├── shopify.extension.toml
    └── src/AIImageModalExtension.tsx
```

## 🔧 API Usada

- **Block → Action**: `navigation.navigate('extension:ai-image-modal')`
- **Action → Close**: `close()` from `useApi<"admin.product-details.action.render">()`
- **GraphQL**: `product.media` con `... on MediaImage { image { url altText } }`

Ya no hay errores de compilación ni modal en loading state! 🎉
