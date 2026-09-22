# Lobo Vendas

Vitrine front-end da minha loja de periféricos e Chaves de ativação steam,  Vendas com catálogo, carrinho persistido no navegador e fluxo visual de checkout.

## Executar localmente

Como o pagamento agora passa pelo backend, inicie a aplicação com Node:

```bash
npm start
```

Depois acesse `http://localhost:4173`.

## Editar produtos

Todos os produtos ficam no arquivo `products.json`, na raiz do projeto. Você pode editar esse arquivo diretamente no VS Code:

- `id`: identificador único, sem espaços, por exemplo `meu-jogo`
- `name`: nome exibido na loja
- `category`: use `steam` ou `gear`
- `description`: informação curta do produto
- `price`: preço atual em reais, por exemplo `19.9`
- `oldPrice`: preço anterior exibido riscado
- `badge`: etiqueta do card, por exemplo `NOVO` ou `-20%`
- `image`: URL da foto do produto

Para adicionar um produto, copie um bloco existente, altere o `id` e os dados. Para excluir, remova o bloco inteiro. Depois salve o arquivo e reinicie o servidor com `npm start`.

O mesmo `products.json` é usado pelo frontend e pelo backend, então o preço mostrado e o preço cobrado permanecem sincronizados.

## Abastecer estoque de códigos

Os códigos ficam em `inventory.json`, separados pelo `id` do produto. Cole cada código dentro da lista correspondente:

```json
{
	"elden-ring": [
		"AAAAA-BBBBB-CCCCC",
		"DDDDD-EEEEE-FFFFF"
	]
}
```

Após um pagamento aprovado, o sistema retira o próximo código da lista e salva o arquivo automaticamente. Se a lista estiver vazia, a compra não libera uma key falsa: ela informa que o estoque está esgotado.

## Editar avaliações

As avaliações exibidas no mini outdoor ficam em `reviews.json`. Adicione novos blocos com `quote`, `name`, `product` e `rating`. Elas passam automaticamente a cada 4,5 segundos.

O checkout PIX cria uma cobrança real no Mercado Pago e exibe o QR Code. A opção cartão abre o Checkout Pro do Mercado Pago.

Para testar em sandbox, use um Access Token que comece com `TEST-` e um usuário de teste como pagador. Tokens `APP_USR-` são de produção e não funcionam com contas de teste; nesse caso, use dados reais de produção.

Para receber webhooks durante o desenvolvimento, `PUBLIC_URL` precisa ser uma URL HTTPS pública (por exemplo, um túnel). `localhost` não pode ser acessado pelos servidores do Mercado Pago.

## Variáveis de ambiente

Copie `.env.example` para `.env` e preencha os valores localmente. O `.env` já está protegido pelo `.gitignore` e não deve ser publicado.

Importante: `MERCADOPAGO_ACCESS_TOKEN` é uma credencial diferente da chave da LevelKeys. Gere o Access Token no painel do Mercado Pago. Ele deve ser usado somente pelo backend, nunca em `index.html` ou `app.js`.

## Integração de produção

O checkout desta primeira versão é uma demonstração de interface. Para ativar pagamentos reais, crie um backend que:

1. Use a credencial privada do Mercado Pago e a API de catálogo em variáveis de ambiente, nunca no JavaScript do navegador.
2. Reserve uma key de forma transacional no servidor ao criar o pedido, evitando que duas compras recebam a mesma key.
3. Crie a preferência/ordem do Mercado Pago e valide o webhook de pagamento no servidor.
4. Entregue a key somente após confirmação aprovada e marque-a como vendida de forma atômica.

O endpoint informado para a API de catálogo é ``. O endpoint de pagamento é  e o webhook é ``.
