# Modelo de site para restaurante · Chapa 62

Site/PWA de cardápio com pedido pelo WhatsApp. Demo com uma hamburgueria fictícia.

- Cardápio com categorias, busca e filtro veggie
- Comanda (carrinho) com quantidade, observação, entrega/retirada/mesa, pagamento e troco
- O pedido vira uma mensagem pronta no WhatsApp
- QR da mesa: `?mesa=12` no endereço
- Horários com "aberto agora", endereço, mapa e Instagram
- Instalável no celular (PWA) e funciona sem internet

## Usar para outro cliente
1. `data/config.json`: nome, WhatsApp (com DDI, ex.: `5562999999999`), endereço, horários, taxa, cores.
2. `data/cardapio.json`: categorias, itens, preços e fotos (`assets/fotos/mini/<foto>.jpg`, 240x240).
3. Trocar textos do `index.html` (título, descrição, Open Graph), ícones em `assets/icons` e `assets/og-image.jpg`.
4. Trocar a `VERSAO` no `sw.js` e o `?v=` do CSS/JS.

Com `whatsapp` vazio, o site fica em modo demonstração: mostra a mensagem em vez de abrir o WhatsApp.

Fotos: Wikimedia Commons (CC0), créditos no rodapé.
