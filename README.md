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

## Segurança e limites
- Não há servidor: o total é calculado no celular do cliente e vai como texto pelo WhatsApp. **O restaurante deve conferir os valores pela própria tabela** antes de confirmar. Para travar preços de verdade, seria preciso um backend (ex.: Cloudflare Worker) que recalcule o pedido.
- Nome, endereço e observações viram uma linha só, sem `* _ ~` — ninguém consegue inserir um "Total" falso na mensagem.
- Os JSON são validados ao abrir; se algo estiver errado, o site mostra um aviso e o motivo aparece no console (F12).
- Opções extras no `config.json`: `fuso` (padrão `America/Sao_Paulo`) e `aceitarFechado` (padrão `true`; `false` bloqueia pedidos fora do horário).
