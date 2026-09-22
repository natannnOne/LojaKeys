# Checklist de deploy da LojaKeys

## 1. Preparar ambiente
- Instalar Node.js LTS
- Instalar dependências com `npm install`
- Criar arquivo `.env` a partir de `.env.production.example`
- Validar que todas as chaves reais foram preenchidas

## 2. Configurar produção
- Definir `PUBLIC_URL` com HTTPS
- Definir `APP_URL` com HTTPS
- Definir `MERCADOPAGO_ACCESS_TOKEN` com token de produção ou sandbox correto
- Definir `MERCADOPAGO_WEBHOOK_SECRET`
- Configurar webhook no Mercado Pago em:
  `https://seu-dominio.com/api/payments/webhook`

## 3. Validar backend
- Rodar `npm start`
- Verificar `http://localhost:4173/api/health`
- Confirmar que responde `200 OK`

## 4. Validar loja
- Acessar a home da loja
- Confirmar que o catálogo carrega
- Confirmar que o carrinho funciona
- Confirmar que o checkout abre

## 5. Testar fluxos
- pagamento PIX em sandbox
- pagamento cartão em sandbox
- entrega da Steam key
- e-mail de confirmação
- webhook do Mercado Pago

## 6. Segurança
- HTTPS habilitado
- headers de segurança ativos
- `.env` fora do repositório
- chaves privadas nunca no frontend
- webhook validado por assinatura

## 7. Deploy final
- Subir a aplicação em servidor de produção
- Conectar domínio
- Ativar HTTPS
- Garantir processo persistente (PM2, systemd, etc.)
- Verificar logs e monitoramento

## 8. Monitoramento
- logs de erro
- erros de pagamento
- webhook rejeitado
- estoque esgotado
- e-mail falhando
