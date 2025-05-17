# Chatbot Nutricionista

Um chatbot inteligente que atua como nutricionista, auxiliando no acompanhamento nutricional através do WhatsApp.

## Funcionalidades

- Coleta de anamnese nutricional
- Acompanhamento de refeições diárias
- Cálculo de IMC
- Cálculo de Taxa Metabólica Basal (TMB)
- Recomendações personalizadas baseadas no perfil do usuário

## Tecnologias Utilizadas

- Node.js
- TypeScript
- Express
- OpenAI GPT
- WhatsApp API (via z-api.io)

## Configuração

1. Clone o repositório:
```bash
git clone [URL_DO_SEU_REPOSITORIO]
cd chatbot-nutricionista
```

2. Instale as dependências:
```bash
npm install
```

3. Configure as variáveis de ambiente:
- Crie um arquivo `.env` na raiz do projeto
- Adicione as seguintes variáveis:
```env
OPENAI_API_KEY=sua_chave_api_aqui
```

4. Inicie o servidor:
```bash
npm run dev
```

## Como Usar

1. Configure sua conta no z-api.io
2. Atualize as credenciais no arquivo `utils.ts`
3. Inicie uma conversa com o bot através do WhatsApp
4. O bot irá guiar você através do processo de anamnese
5. Após completar a anamnese, você pode começar a registrar suas refeições

## Contribuição

Sinta-se à vontade para contribuir com o projeto. Abra uma issue ou envie um pull request.
