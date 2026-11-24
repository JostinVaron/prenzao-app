# Relay propio de Prenzao (opcional)

Por defecto Prenzao sincroniza por varios relays Nostr públicos e independientes. Todo va **cifrado de extremo a extremo** (AES-256-GCM): ningún relay puede leer pedidos, precios, nombres ni direcciones.

Si quieres **soberanía total**, corre este relay en hardware tuyo:

## En un Android viejo (Termux)
```bash
pkg install nodejs git
git clone https://github.com/JostinVaron/prenzao-app && cd prenzao-app/relay
npm install
PORT=7777 node server.mjs
```
Para que los teléfonos lo alcancen desde la calle (datos móviles con CGNAT) necesitas un túnel con TLS (por ejemplo Tailscale Funnel o Cloudflare Tunnel) que te dé una dirección `wss://…`.

Luego en Prenzao: **Negocio → Ajustes → Rutas de sincronización** → agrega `wss://tu-direccion` en todos los teléfonos.

Para que solo acepte a tu negocio: `ALLOW=<pubkey> node server.mjs`.
