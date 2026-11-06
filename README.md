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

## API de pedidos e admin (pasta `api`)
- Cloudflare Worker `chapa62-api` + banco D1 `chapa62`: https://chapa62-api.aconchego-site.workers.dev
- Cada pedido vai para a API, que **recalcula preços e total com o cardápio oficial** (lido do próprio site), guarda no banco e devolve um código de 6 letras + a mensagem do WhatsApp.
- **Admin:** `admin.html` (senha). Lista pedidos (atualiza a cada 20 s, com som para pedido novo), muda status (novo → confirmado → pronto → concluído / cancelado) e **confere mensagens**: cole a mensagem recebida e ele diz se bate com o pedido registrado.
- Regra para o restaurante: vale o que está no admin. Mensagem sem código ou diferente do registrado = conferir antes de aceitar.
- Se a API cair, o site ainda gera a mensagem, marcada "Pedido sem código".
- Limites: 6 pedidos a cada 10 min por conexão; 10 senhas erradas em 15 min bloqueiam o login; pedidos são apagados após 30 dias.
- Senha: o Cloudflare guarda só o hash (PBKDF2). Para trocar: `SENHA='nova' node scripts/gerar-hash.mjs | npx wrangler secret put ADMIN_SENHA_HASH` (dentro de `api`).
- Testes: `npm test` (dentro de `api`). Publicar a API: `npm run deploy`. Local: `npm run dev` + `.dev.vars` com senha de teste.

## Segurança e limites
- Validação no servidor: itens, quantidades (1 a 30), modo, mesa, endereço, pedido mínimo, troco, horário (`aceitarFechado`), tamanho dos campos e campo-isca contra robôs.
- Nome, endereço e observações viram uma linha só, sem `* _ ~` — ninguém consegue inserir um "Total" falso na mensagem.
- Os JSON são validados ao abrir; se algo estiver errado, o site mostra um aviso e o motivo aparece no console (F12).
- Opções no `config.json`: `api`, `fuso` (padrão `America/Sao_Paulo`) e `aceitarFechado` (padrão `true`). Item com `"disponivel": false` no cardápio é recusado pela API.
