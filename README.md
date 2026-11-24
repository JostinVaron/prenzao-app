# Prenzao — app de operación

Reemplaza el papel del trailer: **ventas, pedidos, cobros, gastos y cierre de caja**.
Un solo código (React + TypeScript) que sale como:

| Dispositivo | Cómo se instala | Estado |
|---|---|---|
| Oppo A6c (POS del local) | APK nativo (Capacitor) | ✅ v0.2 |
| iPhone dueña / cocina / empleados | Safari → Compartir → *Agregar a inicio* (PWA) | ✅ v0.2 sincronizado |
| iPhone nativo (App Store / TestFlight) | Mismo código + Apple Developer ($99/año) | ⏳ cuando se decida |

## v0.2 — rediseño completo + sincronización entre teléfonos

**Vistas, no permisos.** En el trailer hay 2 personas y los papeles rotan: cualquiera entra a cualquier vista con un toque. Cada persona solo define con cuál arranca, y la barra de arriba avisa en todo momento qué pasa en cocina, qué está listo y qué falta cobrar.

| Vista | Para qué |
|---|---|
| 🛒 Vender | Venta express: tocas productos y luego 💵 → "Pagó exacto". Lo que más sale va primero. Efectivo tocando los billetes que te dieron (calcula el cambio). Transferencia tocando la cuenta. |
| 🔥 Cocina | Pantalla oscura de alto contraste, cronómetro por pedido, resumen "2 mixtos, 1 hot dog", anuncio en voz alta, pantalla siempre encendida. |
| 🛵 Despacho | Listos para entregar, domicilios con mapa/llamar/WhatsApp, cobro al entregar. |
| 💰 Caja | Lo que falta cobrar, gastos con foto, nómina, cierre de caja. |
| 📊 Negocio | (solo dueña) Panel en vivo, equipo y nómina, carta, teléfonos conectados, link de pedidos. |

**WhatsApp sin fricción**
- Android: en WhatsApp mantén presionado el mensaje → ⋮ → Compartir → **Prenzao**. El pedido se arma solo (productos, cantidades, notas, dirección, nombre, celular, pago, "paga con 50 mil", urgencia).
- iPhone: copia el mensaje → botón verde "Pedido de WhatsApp".
- Link de menú para clientes (Negocio → Ajustes): el cliente arma el pedido y te llega un mensaje con un código que Prenzao lee exacto.

**Sincronización local-first y cifrada** (`src/lib/sync/`)
- Cada teléfono guarda todo y funciona sin internet.
- Los cambios viajan cifrados de extremo a extremo (AES-256-GCM, llave derivada con HKDF de un secreto de 32 bytes que solo tienen los teléfonos vinculados por QR) como eventos Nostr NIP-78 firmados, a 6 relays públicos independientes a la vez.
- Fusión determinista con reloj lógico híbrido: los estados de un pedido solo avanzan, un pago confirmado no se pierde, la bitácora se une sin duplicados. Anti-entropía: si un teléfono sabe algo que otro no, lo vuelve a publicar.
- Soberanía total opcional: `relay/` es un relay propio que corre en Termux.

**Notificaciones** con canal de prioridad alta, sonido propio (`res/raw/cobro.wav`, `campana.wav`) y burbuja.

## Desarrollo

```bash
npm install
npm run dev          # abre en el navegador del celular: http://IP:5173
npm run build        # typecheck + build
```

Desde Termux en el S25 funciona directo (Node nativo, sin proot).

## Builds automáticos

- `push` a `main` → **Actions → Android APK** genera el APK firmado (artefacto).
- Commit con `[release]` en el mensaje, o *Actions → Android APK → Run workflow* → publica un **Release** con el APK en `github.com/JostinVaron/prenzao-app/releases/latest`.
- `push` a `main` → **PWA** se publica en la rama `gh-pages` → `https://jostinvaron.github.io/prenzao-app/`.

### Firma (una sola vez)

Settings → Secrets and variables → Actions → **New repository secret**
- Nombre: `PRENZAO_SIGNING`
- Valor: el contenido del archivo `PRENZAO_SIGNING.txt` (te lo envía Jarvis por el chat; **no lo subas al repo**).

Sin la misma firma, Android no deja actualizar encima y habría que desinstalar (se perderían los datos locales).
