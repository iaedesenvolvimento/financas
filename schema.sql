CREATE DATABASE IF NOT EXISTS financas_hubly
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE financas_hubly;

CREATE TABLE IF NOT EXISTS users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  google_id VARCHAR(80) NULL UNIQUE,
  name VARCHAR(120) NOT NULL,
  email VARCHAR(160) NOT NULL UNIQUE,
  picture TEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE users ADD COLUMN IF NOT EXISTS google_id VARCHAR(80) NULL UNIQUE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS picture TEXT NULL;

CREATE TABLE IF NOT EXISTS transactions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  title VARCHAR(160) NOT NULL,
  amount DECIMAL(12, 2) NOT NULL,
  type ENUM('income', 'expense') NOT NULL,
  category VARCHAR(80) NOT NULL,
  transaction_date DATE NOT NULL,
  status ENUM('paid', 'pending') NOT NULL DEFAULT 'paid',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_transactions_user
    FOREIGN KEY (user_id) REFERENCES users(id)
    ON DELETE CASCADE
);

CREATE INDEX idx_transactions_user_date ON transactions (user_id, transaction_date);
CREATE INDEX idx_transactions_type ON transactions (type);

CREATE TABLE IF NOT EXISTS goals (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  title VARCHAR(160) NOT NULL,
  current_amount DECIMAL(12, 2) NOT NULL DEFAULT 0,
  target_amount DECIMAL(12, 2) NOT NULL,
  category VARCHAR(80) NOT NULL DEFAULT 'Reserva',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_goals_user
    FOREIGN KEY (user_id) REFERENCES users(id)
    ON DELETE CASCADE
);

INSERT INTO users (id, name, email)
VALUES (1, 'Usuário', 'usuario@email.com')
ON DUPLICATE KEY UPDATE name = VALUES(name), email = VALUES(email);
