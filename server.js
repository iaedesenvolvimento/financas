require('dotenv').config();

const path = require('path');
const express = require('express');
const { Pool } = require('pg');
const jwt = require('jsonwebtoken');
const { OAuth2Client } = require('google-auth-library');

const app = express();
const port = Number(process.env.PORT || 3000);
const googleClientId = process.env.GOOGLE_CLIENT_ID || '';
const jwtSecret = process.env.JWT_SECRET || 'troque-este-segredo';

console.log('🔍 Variáveis de Ambiente Carregadas:');
console.log('- PORT:', process.env.PORT);
console.log('- GOOGLE_CLIENT_ID:', googleClientId ? '✓ Configurado' : '✗ Vazio');
console.log('- DB_HOST:', process.env.DB_HOST);
console.log('- NODE_ENV:', process.env.NODE_ENV);

const googleClient = new OAuth2Client(googleClientId);

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT || 5432),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'financas_hubly',
});

app.use(express.json());
app.get('/favicon.ico', (_req, res) => res.status(204).end());
app.use(express.static(path.join(__dirname, 'public')));

function sessionToken(userId) {
  return jwt.sign({ userId }, jwtSecret, { expiresIn: '7d' });
}

function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';

  if (!token) {
    return res.status(401).json({ message: 'Login necessário.' });
  }

  try {
    req.userId = jwt.verify(token, jwtSecret).userId;
    next();
  } catch {
    res.status(401).json({ message: 'Sessão inválida ou expirada.' });
  }
}

function mapTransaction(row) {
  return {
    id: row.id,
    title: row.title,
    amount: Number(row.amount),
    type: row.type,
    category: row.category,
    date: row.transaction_date,
    status: row.status
  };
}

function isValidTransaction(body) {
  return (
    body &&
    typeof body.title === 'string' &&
    body.title.trim() &&
    Number(body.amount) > 0 &&
    ['income', 'expense'].includes(body.type) &&
    typeof body.category === 'string' &&
    body.category.trim() &&
    /^\d{4}-\d{2}-\d{2}$/.test(body.date || '') &&
    ['paid', 'pending'].includes(body.status || 'paid')
  );
}

app.get('/api/health', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    console.log('✓ Health check: Banco de dados conectado');
    res.json({ ok: true, database: 'connected' });
  } catch (error) {
    console.error('✗ Health check: Banco de dados indisponível', error.message);
    res.status(500).json({ ok: false, message: 'Banco de dados indisponível.' });
  }
});

app.get('/api/config', (_req, res) => {
  res.json({ googleClientId });
});

app.post('/api/auth/google', async (req, res, next) => {
  try {
    console.log('📌 POST /api/auth/google recebido');
    
    if (!googleClientId) {
      console.error('❌ GOOGLE_CLIENT_ID não configurado');
      return res.status(500).json({ message: 'GOOGLE_CLIENT_ID não configurado no .env.' });
    }

    const { credential } = req.body;
    if (!credential) {
      console.error('❌ Credencial do Google não enviada');
      return res.status(400).json({ message: 'Credencial do Google não enviada.' });
    }

    console.log('🔐 Verificando token do Google...');
    const ticket = await googleClient.verifyIdToken({
      idToken: credential,
      audience: googleClientId
    });
    console.log('✓ Token verificado com sucesso');
    
    const googleUser = ticket.getPayload();

    const user = {
      googleId: googleUser.sub,
      name: googleUser.name || googleUser.email,
      email: googleUser.email,
      picture: googleUser.picture || null
    };

    console.log('👤 Usuário do Google:', user.email);
    console.log('🔍 Procurando usuário no banco de dados...');
    
    const checkUser = await pool.query(
      'SELECT id FROM users WHERE google_id = $1 OR email = $2 LIMIT 1',
      [user.googleId, user.email]
    );

    let userId;
    if (checkUser.rows.length) {
      console.log('✓ Usuário encontrado, atualizando...');
      userId = checkUser.rows[0].id;
      await pool.query(
        'UPDATE users SET google_id = $1, name = $2, email = $3, picture = $4 WHERE id = $5',
        [user.googleId, user.name, user.email, user.picture, userId]
      );
    } else {
      console.log('✓ Novo usuário, criando...');
      const result = await pool.query(
        'INSERT INTO users (google_id, name, email, picture) VALUES ($1, $2, $3, $4) RETURNING id',
        [user.googleId, user.name, user.email, user.picture]
      );
      userId = result.rows[0].id;
    }

    console.log('✓ Login realizado com sucesso. User ID:', userId);
    res.json({
      token: sessionToken(userId),
      user: { id: userId, name: user.name, email: user.email, picture: user.picture }
    });
  } catch (error) {
    console.error('❌ Erro em /api/auth/google:', error.message);
    console.error('Stack:', error.stack);
    next(error);
  }
});

app.get('/api/user', requireAuth, async (req, res, next) => {
  try {
    const result = await pool.query(
      'SELECT id, name, email, picture FROM users WHERE id = $1 LIMIT 1',
      [req.userId]
    );

    if (!result.rows.length) {
      return res.status(404).json({ message: 'Usuário não encontrado.' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    next(error);
  }
});

app.get('/api/transactions', requireAuth, async (req, res, next) => {
  try {
    const search = String(req.query.search || '').trim();
    const period = String(req.query.period || 'current');
    const params = [req.userId];
    let where = 'WHERE user_id = $1';
    let paramCount = 2;

    if (search) {
      where += ` AND (title ILIKE $${paramCount} OR category ILIKE $${paramCount + 1})`;
      params.push(`%${search}%`, `%${search}%`);
      paramCount += 2;
    }

    if (period === 'current') {
      where += ` AND DATE_TRUNC('month', transaction_date) = DATE_TRUNC('month', CURRENT_DATE)`;
    } else if (period === 'previous') {
      where += ` AND DATE_TRUNC('month', transaction_date) = DATE_TRUNC('month', CURRENT_DATE - INTERVAL '1 month')`;
    }

    const result = await pool.query(
      `SELECT id, title, amount, type, category, transaction_date, status FROM transactions ${where} ORDER BY transaction_date DESC`,
      params
    );

    res.json(result.rows.map(mapTransaction));
  } catch (error) {
    next(error);
  }
});

app.post('/api/transactions', requireAuth, async (req, res, next) => {
  try {
    if (!isValidTransaction(req.body)) {
      return res.status(400).json({ message: 'Dados inválidos.' });
    }

    const { title, amount, type, category, date, status } = req.body;
    const result = await pool.query(
      'INSERT INTO transactions (user_id, title, amount, type, category, transaction_date, status) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *',
      [req.userId, title, amount, type, category, date, status || 'paid']
    );

    res.status(201).json(mapTransaction(result.rows[0]));
  } catch (error) {
    next(error);
  }
});

app.get('/api/transactions/:id', requireAuth, async (req, res, next) => {
  try {
    const result = await pool.query(
      'SELECT * FROM transactions WHERE id = $1 AND user_id = $2',
      [req.params.id, req.userId]
    );

    if (!result.rows.length) {
      return res.status(404).json({ message: 'Transação não encontrada.' });
    }

    res.json(mapTransaction(result.rows[0]));
  } catch (error) {
    next(error);
  }
});

app.put('/api/transactions/:id', requireAuth, async (req, res, next) => {
  try {
    if (!isValidTransaction(req.body)) {
      return res.status(400).json({ message: 'Dados inválidos.' });
    }

    const { title, amount, type, category, date, status } = req.body;
    const result = await pool.query(
      'UPDATE transactions SET title = $1, amount = $2, type = $3, category = $4, transaction_date = $5, status = $6 WHERE id = $7 AND user_id = $8 RETURNING *',
      [title, amount, type, category, date, status, req.params.id, req.userId]
    );

    if (!result.rows.length) {
      return res.status(404).json({ message: 'Transação não encontrada.' });
    }

    res.json(mapTransaction(result.rows[0]));
  } catch (error) {
    next(error);
  }
});

app.delete('/api/transactions/:id', requireAuth, async (req, res, next) => {
  try {
    const result = await pool.query(
      'DELETE FROM transactions WHERE id = $1 AND user_id = $2',
      [req.params.id, req.userId]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ message: 'Transação não encontrada.' });
    }

    res.json({ message: 'Transação deletada.' });
  } catch (error) {
    next(error);
  }
});

app.get('/api/goals', requireAuth, async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT id, title, current_amount, target_amount, category
       FROM goals
       WHERE user_id = $1
       ORDER BY id DESC`,
      [req.userId]
    );

    res.json(result.rows.map(row => ({
      id: row.id,
      title: row.title,
      currentAmount: Number(row.current_amount),
      targetAmount: Number(row.target_amount),
      category: row.category
    })));
  } catch (error) {
    next(error);
  }
});

app.use((error, _req, res, _next) => {
  console.error('💥 ERRO NÃO TRATADO:');
  console.error('  Mensagem:', error.message);
  console.error('  Stack:', error.stack);
  res.status(500).json({ message: 'Erro interno no servidor.', error: error.message });
});

app.listen(port, () => {
  console.log(`Servidor rodando em http://localhost:${port}`);
});
