# ⚡ Telegram ➔ WhatsApp Offer Forwarder

Ferramenta pessoal em Node.js + TypeScript para clonar mensagens e ofertas de um canal público do Telegram (via GramJS MTProto) e repassá-las diretamente para um destino no WhatsApp (via Baileys), com painel visual web e logs em tempo real.

---

## 🚀 Como Executar

### 1. Instalar dependências
```bash
npm install
```

### 2. Iniciar em modo de desenvolvimento
```bash
npm run dev
```

### 3. Acessar o Painel Web
Abra seu navegador em: **`http://localhost:3000`**

---

## ⚙️ Como Configurar

### 1. Origem (Telegram MTProto - GramJS)
1. Obtenha gratuitamente seu `API ID` e `API Hash` em [my.telegram.org](https://my.telegram.org).
2. No painel, insira o `API ID`, `API Hash` e seu número de telefone com DDI (ex: `+5511999999999`).
3. Clique em **Enviar Código de Login**.
4. Digite o código de 5 dígitos recebido no seu Telegram.
5. Se tiver senha de 2 etapas (2FA), digite a senha quando solicitada.
6. A sessão é salva automaticamente em `data/telegram.session` e não precisará ser refeita nas próximas execuções.

### 2. Destino (WhatsApp - Baileys)
1. No painel, o QR Code será exibido automaticamente.
2. Abra seu WhatsApp no celular ➔ **Aparelhos conectados** ➔ **Conectar um aparelho** e escaneie o QR Code.
3. A sessão é salva em `data/auth_whatsapp`.

### 3. Canal de Origem e Destino
No painel (ou diretamente no arquivo `data/config.json`):
- **Canal de Origem (Telegram):** `@nome_do_canal` (ex: `@promocoesimperdiveis`). A conta entra automaticamente no canal e escuta novos posts.
- **JID de Destino (WhatsApp):** 
  - Grupo: `120363024823901928@g.us`
  - Canal/Newsletter: `120363144123456789@newsletter`
  - Conversa direta/Pessoal: `5511999999999@s.whatsapp.net` (ou apenas o número com DDD)

---

## 📦 Estrutura do Projeto

```
├── data/                       # Dados persistentes (sessões e configs)
│   ├── config.json             # Configurações de canal, JID e credenciais
│   ├── telegram.session        # Sessão salva do Telegram
│   └── auth_whatsapp/          # Sessão multi-file do Baileys
├── public/                     # Painel Web Frontend
│   ├── index.html              # Interface do usuário
│   ├── style.css               # Estilos Dark Mode
│   └── app.js                  # Lógica SSE, autenticação e formulários
├── src/
│   ├── config/
│   │   └── config.service.ts   # Gerenciamento do config.json
│   ├── routes/
│   │   └── api.routes.ts       # Rotas REST e streaming SSE
│   ├── services/
│   │   ├── forwarder.service.ts# Repassador de mensagens Telegram -> WhatsApp
│   │   ├── logger.service.ts   # Logger central e emissor para SSE
│   │   ├── telegram.service.ts # Cliente GramJS (MTProto, login, escuta)
│   │   └── whatsapp.service.ts # Cliente Baileys (QR, envio texto/imagem)
│   ├── types/
│   │   └── index.ts            # Interfaces TypeScript
│   └── server.ts               # Servidor Express
├── package.json
├── tsconfig.json
└── README.md
```

---

## 📜 Logs em Tempo Real
O painel exibe logs com cores e tags identificando cada etapa:
- `[TELEGRAM]` Conexão estabelecida, canal verificado, nova mensagem recebida, download de mídia.
- `[WHATSAPP]` Inicialização, novo QR gerado, conexão aberta, envio de mensagens.
- `[FORWARDER]` Captura da mensagem do Telegram e repasse bem-sucedido para o WhatsApp.
