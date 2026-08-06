# Publicación del sitio

La app es HTML estático servido por GitHub Pages desde la rama `main`.

## `.nojekyll` — no borrar

GitHub Pages, por omisión, pasa el repositorio por Jekyll antes de publicarlo. Nosotros no
usamos Jekyll: es un archivo HTML y dos librerías. Ese paso intermedio no aporta nada y sí
puede fallar, y cuando falla **el sitio se queda sirviendo la última versión que sí compiló,
en silencio**: se hace `git push`, el commit llega a GitHub, y aun así nadie ve el cambio.

Pasó el 06-08-2026: dos commits quedaron sin publicar durante horas por un build fallido.

El archivo `.nojekyll` vacío en la raíz le dice a GitHub que publique los archivos tal cual.

## Si un cambio no aparece en el sitio

1. Recargar forzando caché: `Ctrl` + `Shift` + `R`.
2. Revisar que el commit esté en GitHub.
3. Revisar el estado de la publicación: pestaña **Actions** del repositorio, o
   `GET /repos/Fleepx/novetec-app/pages/builds`. Si el último dice `errored`, el sitio está
   sirviendo una versión vieja aunque el código esté subido.
