# Financas Hubly

Aplicação Node.js para gerenciamento de finanças com banco de dados MySQL.

## Instalação Local

1. Clone o repositório:
```bash
git clone https://github.com/seu-usuario/financas.git
cd financas
```

2. Instale as dependências:
```bash
npm install
```

3. Configure as variáveis de ambiente:
```bash
cp .env.example .env
```
Edite o arquivo `.env` com suas credenciais reais do banco de dados e chaves do Google.

4. Configure o banco de dados:
```bash
mysql -u root -p < schema.sql
```

5. Inicie o servidor:
```bash
npm start
```

A aplicação estará disponível em `http://localhost:3000`

## Deploy em Produção

Este é um aplicativo Node.js com banco de dados, não é compatível com GitHub Pages (que é apenas para sites estáticos).

### Opções recomendadas para deploy:

- **Railway** (recomendado - fácil e com banco de dados incluído)
- **Render**
- **Heroku**
- **AWS, DigitalOcean, Linode** (mais complexo, mas mais controle)

## Variáveis de Ambiente Necessárias

- `PORT` - Porta do servidor (padrão: 3000)
- `DB_HOST` - Host do banco de dados MySQL
- `DB_PORT` - Porta do MySQL (padrão: 3306)
- `DB_USER` - Usuário do banco de dados
- `DB_PASSWORD` - Senha do banco de dados
- `DB_NAME` - Nome do banco de dados
- `GOOGLE_CLIENT_ID` - ID do cliente Google OAuth
- `JWT_SECRET` - Chave secreta para JWT

## Estrutura do Projeto

```
├── public/          # Arquivos estáticos (HTML, CSS, JS)
├── server.js        # Arquivo principal do servidor
├── schema.sql       # Estrutura do banco de dados
├── package.json     # Dependências do projeto
└── .env             # Variáveis de ambiente (não incluído no Git)
```
