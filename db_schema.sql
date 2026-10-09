-- 1. Users Table
CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    telegram_id VARCHAR(100) UNIQUE NOT NULL,
    krypton_balance NUMERIC(18, 9) DEFAULT 0.000000000,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 2. Bases Table (Mars Base Infrastructure)
CREATE TABLE IF NOT EXISTS bases (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    farm_dome_level INTEGER DEFAULT 1,
    factory_level INTEGER DEFAULT 1,
    laboratory_level INTEGER DEFAULT 1,
    armory_level INTEGER DEFAULT 1,
    stored_energy NUMERIC(10, 2) DEFAULT 100.00,
    max_energy NUMERIC(10, 2) DEFAULT 100.00,
    last_mined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 3. Construction Queues Table (Token Sinks / Upgrades)
CREATE TABLE IF NOT EXISTS construction_queues (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    building_type VARCHAR(50) NOT NULL,
    target_level INTEGER NOT NULL,
    krypton_cost NUMERIC(18, 9) NOT NULL,
    finishes_at TIMESTAMP NOT NULL,
    status VARCHAR(20) DEFAULT 'IN_PROGRESS',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 4. Ad Reward Logs Table
CREATE TABLE IF NOT EXISTS ad_reward_logs (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    session_id VARCHAR(255),
    reward_type VARCHAR(50) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 5. Prediction Bets Table
CREATE TABLE IF NOT EXISTS prediction_bets (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    asset VARCHAR(20) NOT NULL,
    direction VARCHAR(10) NOT NULL,
    stake_amount NUMERIC(18, 9) NOT NULL,
    status VARCHAR(20) DEFAULT 'ACTIVE',
    locked_until TIMESTAMP NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);