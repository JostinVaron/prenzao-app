# Prenzao — app de operación

Reemplaza el papel del trailer: **ventas, pedidos, cobros, gastos y cierre de caja**.
Un solo código (React + TypeScript) que sale como:

| Dispositivo | Cómo se instala | Estado |
|---|---|---|
| Oppo A6c (POS del local) | APK nativo (Capacitor) | ✅ v0.1 |
| iPhone dueña / cocina / empleados | Safari → Compartir → *Agregar a inicio* (PWA) | ✅ v0.1 (datos locales por ahora) |
| iPhone nativo (App Store / TestFlight) | Mismo código + Apple Developer ($99/año) | ⏳ cuando se decida |

## Qué hace la v0.1

- **Vender**: carta real (19 productos del CSV), mostrador o domicilio, notas por producto ("sin cebolla"), flujo guiado en 3 pasos, cálculo de cambio, cuenta destino obligatoria en transferencias.
- **Pedidos**: cola en vivo con tiempos (se pone ámbar a los 15 min, rojo a los 25), estados *En preparación → Listo → En camino → Entregado*, cancelación solo con motivo (nunca se borran), aviso al cliente por WhatsApp con un toque.
- **Insistencia "a prueba de no usarla"**: la app pregunta cada N minutos *"¿Ya pagaron el pedido #12?"* y *"¿Ya se entregó?"* hasta que alguien confirme. En Android también llegan notificaciones aunque la app esté cerrada.
- **Gastos**: valor, categoría, proveedor, foto de la factura, si salió de la caja.
- **Hoy**: ventas, efectivo vs transferencias (por cuenta), por cobrar, gastos, ventas por hora, más vendidos, últimos 7 días, **cierre de caja** con sobrante/faltante.
- **Más**: editar carta y precios, marcar agotados, PIN de la dueña, exportar ventas/gastos a CSV (Excel), respaldo completo.

> ⚠️ v0.1 guarda los datos **solo en el teléfono**. Haz *Más → Hacer respaldo completo* a diario hasta la v0.2 (nube).

## Desarrollo

```bash
npm install
npm run dev          # abre en el navegador del celular: http://IP:5173
npm run build        # typecheck + build
```

Desde Termux en el S25 funciona directo (Node nativo, sin proot).

## Builds automáticos

- `push` a `main` → **Actions → Android APK** genera el APK firmado (artefacto).
- Tag `vX.Y.Z` → publica un **Release** con el APK.
- `push` a `main` → **PWA** se publica en la rama `gh-pages` → `https://jostinvaron.github.io/prenzao-app/`.

### Firma (una sola vez)

Settings → Secrets and variables → Actions → **New repository secret**
- Nombre: `PRENZAO_SIGNING`
- Valor: el contenido del archivo `PRENZAO_SIGNING.txt` (te lo envía Jarvis por el chat; **no lo subas al repo**).

Sin la misma firma, Android no deja actualizar encima y habría que desinstalar (se perderían los datos locales).
