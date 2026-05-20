require('dotenv').config();

const path = require('path');
const express = require('express');
const mysql = require('mysql2/promise');
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

const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'financas_hubly',
  waitForConnections: true,
  connectionLimit: 10,
  decimalNumbers: true,
  dateStrings: true
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
    const [rows] = await pool.query('SELECT 1');
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
    
    const [existing] = await pool.query(
      'SELECT id FROM users WHERE google_id = ? OR email = ? LIMIT 1',
      [user.googleId, user.email]
    );

    let userId;
    if (existing.length) {
      console.log('✓ Usuário encontrado, atualizando...');
      userId = existing[0].id;
      await pool.execute(
        'UPDATE users SET google_id = ?, name = ?, email = ?, picture = ? WHERE id = ?',
        [user.googleId, user.name, user.email, user.picture, userId]
      );
    } else {
      console.log('✓ Novo usuário, criando...');
      const [result] = await pool.execute(
        'INSERT INTO users (google_id, name, email, picture) VALUES (?, ?, ?, ?)',
        [user.googleId, user.name, user.email, user.picture]
      );
      userId = result.insertId;
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
    const [rows] = await pool.query(
      'SELECT id, name, email, picture FROM users WHERE id = ? LIMIT 1',
      [req.userId]
    );

    if (!rows.length) {
      return res.status(404).json({ message: 'Usuário não encontrado.' });
    }

    res.json(rows[0]);
  } catch (error) {
    next(error);
  }
});

app.get('/api/transactions', requireAuth, async (req, res, next) => {
  try {
    const search = String(req.query.search || '').trim();
    const period = String(req.query.period || 'current');
    const params = [req.userId];
    let where = 'WHERE user_id = ?';

    if (search) {
      where += ' AND (title LIKE ? OR category LIKE ?)';
      params.push(`%${search}%`, `%${search}%`);
    }

    if (period === 'current') {
      where += ' AND YEAR(transaction_date) = YEAR(CURDATE()) AND MONTH(transaction_date) = MONTH(CURDATE())';
    } else if (period === 'previous') {
      where += ' AND YEAR(transaction_date) = YEAR(CURDATE() - INTERVAL 1 MONTH) AND MONTH(transaction_date) = MONTH(CURDATE() - INTERVAL 1 MONTH)';
    }

    const [rows] = await pool.query(
      `SELECT id, title, amount, type, category, transaction_date, status
       FROM transactions
       ${where}
       ORDER BY transaction_date DESC, id DESC`,
      params
    );

    res.json(rows.map(mapTransaction));
  } catch (error) {
    next(error);
  }
});

app.post('/api/transactions', requireAuth, async (req, res, next) => {
  try {
    if (!isValidTransaction(req.body)) {
      return res.status(400).json({ message: 'Dados da transação inválidos.' });
    }

    const tx = {
      title: req.body.title.trim(),
      amount: Number(req.body.amount),
      type: req.body.type,
      category: req.body.category.trim(),
      date: req.body.date,
      status: req.body.status || 'paid'
    };

    const [result] = await pool.execute(
      `INSERT INTO transactions
        (user_id, title, amount, type, category, transaction_date, status)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [req.userId, tx.title, tx.amount, tx.type, tx.category, tx.date, tx.status]
    );

    res.status(201).json({ id: result.insertId, ...tx });
  } catch (error) {
    next(error);
  }
});

app.get('/api/summary', requireAuth, async (req, res, next) => {
  try {
    const [totals] = await pool.query(
      `SELECT
        COALESCE(SUM(CASE WHEN type = 'income' THEN amount ELSE 0 END), 0) AS incomes,
        COALESCE(SUM(CASE WHEN type = 'expense' THEN amount ELSE 0 END), 0) AS expenses
       FROM transactions
       WHERE user_id = ?
         AND YEAR(transaction_date) = YEAR(CURDATE())
         AND MONTH(transaction_date) = MONTH(CURDATE())`,
      [req.userId]
    );

    const [categories] = await pool.query(
      `SELECT category, COALESCE(SUM(amount), 0) AS total
       FROM transactions
       WHERE user_id = ?
         AND type = 'expense'
         AND YEAR(transaction_date) = YEAR(CURDATE())
         AND MONTH(transaction_date) = MONTH(CURDATE())
       GROUP BY category
       ORDER BY total DESC`,
      [req.userId]
    );

    res.json({
      incomes: Number(totals[0].incomes),
      expenses: Number(totals[0].expenses),
      balance: Number(totals[0].incomes) - Number(totals[0].expenses),
      expensesByCategory: categories.map(row => ({
        category: row.category,
        total: Number(row.total)
      }))
    });
  } catch (error) {
    next(error);
  }
});

app.get('/api/goals', requireAuth, async (req, res, next) => {
  try {
    const [rows] = await pool.query(
      `SELECT id, title, current_amount, target_amount, category
       FROM goals
       WHERE user_id = ?
       ORDER BY id DESC`,
      [req.userId]
    );

    res.json(rows.map(row => ({
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
