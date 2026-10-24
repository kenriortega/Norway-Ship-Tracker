# Guía de estilos · Norway Ship Tracker

La interfaz toma de rails-tracker-monitor la composición operativa, las superficies
oscuras, los bordes finos y la tipografía técnica. La base cromática es azul marino
con azul hielo para acciones y selección.

## Tokens

La fuente de verdad es `apps/web/app/globals.css`; Tailwind expone estos tokens.

| Token | Valor | Uso |
| --- | --- | --- |
| background | #080F1C | Fondo general |
| card | #101D30 | Paneles y resumen |
| surface-raised | #162740 | Popups y controles del mapa |
| secondary | #1B3451 | Hover y superficies secundarias |
| border | #2B4059 | Separadores decorativos |
| control-border | #627D9E | Límites de controles interactivos |
| foreground | #E7EFF9 | Texto principal |
| muted-foreground | #9BAFC7 | Texto secundario |
| primary | #85C7FF | Acciones, selección y gráficos |
| primary-foreground | #081525 | Texto sobre relleno primary |
| ring | #B9E1FF | Foco y anillo de selección |
| success | #7DD3A8 | Estado saludable |
| warning | #F2C879 | Advertencias |
| danger | #FF9A9A | Errores |

No usar `border` para identificar por sí solo un control. Usar `control-border`,
un texto identificativo y foco visible. No depender únicamente del color.

## Tipografía y medidas

- Sans: Inter si está disponible, Helvetica Neue, Arial y sans-serif. No se
  descarga una fuente externa ni se añade una dependencia.
- Mono: SFMono-Regular, Consolas, Liberation Mono y monospace para métricas,
  MMSI, velocidades, horas y coordenadas; números tabulares donde corresponda.
- Título: 28–32 px; paneles: 14–16 px; cuerpo: 14 px; auxiliares: 12 px.
- Métricas: 30 px. Espaciado: 4, 8, 12, 16, 24 y 32 px.
- Paneles con radio de 8 px y padding de 16–20 px; controles con radio de 6 px.
- Controles de mapa de 36 px en escritorio y 44 px en móvil. Slider con área
  de interacción de 44 px. Sombras reservadas para superficies superpuestas.

## Composición y estados

Cabecera compacta → contexto → resumen de cuatro métricas → mapa → análisis →
atribución. El mapa sigue disponible si las métricas cargan o fallan, y viceversa.
El resumen usa dos columnas en móvil y cuatro en escritorio. Las barras analíticas
pasan a una segunda línea en móvil para conservar etiquetas y valores legibles.

Filtros y análisis permanecen visibles desde 640 px. Por debajo, dos botones
abren un único panel a la vez, con `aria-expanded` y `aria-controls`; las categorías
y capas mantienen `aria-pressed`. Los estados de error incluyen texto y reintento.

El estado del mapa muestra recuento y hora de actualización recibida. No se afirma
que todas las posiciones sean recientes: esa información aparece en las métricas.

## Cartografía

Se conserva el raster topográfico de Kartverket, su proveedor y sus atribuciones.
No se recolorean por separado tierra y agua: esos colores vienen en la imagen.
La interfaz azul rodea la cartografía sin filtros CSS que alteren su significado.

La codificación existente de barcos es por velocidad, no por categoría:
azul para ≥ 0,5 kn; ámbar para < 0,5 kn o velocidad ausente. Una leyenda lo explica.
La selección añade un anillo claro sin cambiar el color del barco. El recorrido
usa un degradado azul; las capas de análisis conservan sus colores e identificadores.

## Accesibilidad y validación

Foco visible de 2 px, textos auxiliares de al menos 12 px y controles táctiles de
44 px. Las transiciones de color duran 150 ms. `prefers-reduced-motion` desactiva
animaciones y transiciones CSS. La atribución a Kystverket y NLOD 2.0 permanece
visible en la página y disponible dentro del mapa.

Validar con typecheck, lint y build de la web. Revisar en navegador escritorio y
móvil: apertura exclusiva de paneles, teclado, reintentos, popups y ausencia de
scroll horizontal. Contraste objetivo: 4,5:1 para texto normal y 3:1 para límites
de controles esenciales. La navegación lateral y un inspector independiente
quedan fuera de esta adaptación.

## Registro de esta adaptación

- TypeScript, ESLint y build de producción verificados.
- Revisión visual con datos disponibles y mapa en escritorio y móvil (320 y 390 px).
- Comprobados filtros por categoría, slider con teclado, restablecimiento y
  apertura exclusiva de paneles móviles. Popup y recorrido de 24 h comprobados.
- Contraste calculado: texto secundario/card 7,54:1; texto secundario/superficie
  elevada 6,69:1; borde de control/superficie elevada 3,54:1.
- La cartografía raster y sus colores originales se conservan.
