# novetec-app

Front de gestión de despachos de **Novetec SPA**. Página estática, sin backend: lee y escribe directamente en el repositorio privado `novetec-datos` usando la API de GitHub.

## Publicar con GitHub Pages
1. Subir `index.html` y este README a la rama `main`.
2. En el repo: **Settings → Pages → Source: Deploy from a branch → main / (root)**.
3. La página queda en `https://<usuario>.github.io/novetec-app/`.

## Primer uso (cada persona, una vez)
1. Abrir la página.
2. Ingresar: usuario/organización de GitHub, nombre del repo de datos (`novetec-datos`) y un token *fine-grained* con permiso **Contents: Read and write** sobre ese repo.
3. El token queda guardado solo en el navegador (localStorage). Con "cambiar conexión" se borra.

## Qué hace
- **Panel**: semáforo de OC (vencidas / rojo ≤5 días / ámbar ≤10 / verde) y pendientes.
- **Cotizaciones**: registro, conversión a OC, rechazo, adjuntos PDF/imagen.
- **Órdenes de compra**: siempre nacen de una cotización; avance pedido vs. despachado; marca de compra realizada.
- **Guías de despacho**: despachos parciales por OC; al registrar descuenta inventario automáticamente.
- **Inventario**: stock, ingresos, ajustes y bitácora de movimientos.

Las hojas de ruta (.docx) se generan en Claude a partir de las guías registradas.
