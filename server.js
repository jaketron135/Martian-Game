/**
 * =========================================================================
 * MARTIAN MINI APP: Master Production Backend Server (Node.js & Express)
 * Kasama ang Lahat ng Checklist Scenarios at TON Wallet Integration
 * =========================================================================
 */

const express = require('express');
const { Pool } = require('pg');

const app = express();
app.use(express.json());

// I-configure ang iyong PostgreSQL connection pool
const pool = new Pool({
    user: 'postgres',
    host: 'localhost',
    database: 'martian_game',
    password: 'password_mo_dito', // Palitan ng iyong postgres password kung kinakailangan
    port: 5432,
});

// -------------------------------------------------------------------------
// 1. User Auth & Base Initialization Endpoint (Telegram Mini App Entry)
// -------------------------------------------------------------------------
app.post('/api/user/auth', async (req, res) => {
    const { telegramId } = req.body;
    if (!telegramId) {
        return res.status(400).json({ error: 'Mawawalang Telegram ID para sa authentication.' });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        let userResult = await client.query(`SELECT id, krypton_balance, ton_wallet_address FROM users WHERE telegram_id = $1`, [telegramId]);
        let userId;
        let kryptonBalance;
        let tonWalletAddress;

        if (userResult.rows.length === 0) {
            const newUser = await client.query(
                `INSERT INTO users (telegram_id, krypton_balance) VALUES ($1, $2) RETURNING id, krypton_balance, ton_wallet_address`,
                [telegramId, 1.000000000]
            );
            userId = newUser.rows[0].id;
            kryptonBalance = newUser.rows[0].krypton_balance;
            tonWalletAddress = newUser.rows[0].ton_wallet_address;

            await client.query(
                `INSERT INTO bases (user_id, farm_dome_level, factory_level, laboratory_level, armory_level) VALUES ($1, 1, 1, 1, 1)`,
                [userId]
            );
        } else {
            userId = userResult.rows[0].id;
            kryptonBalance = userResult.rows[0].krypton_balance;
            tonWalletAddress = userResult.rows[0].ton_wallet_address;
        }

        const baseResult = await client.query(`SELECT * FROM bases WHERE user_id = $1`, [userId]);
        const baseData = baseResult.rows[0];

        await client.query('COMMIT');
        return res.json({
            success: true,
            telegramId,
            kryptonBalance: parseFloat(kryptonBalance),
            tonWalletAddress: tonWalletAddress || null,
            base: {
                farmDomeLevel: baseData.farm_dome_level,
                factoryLevel: baseData.factory_level,
                laboratoryLevel: baseData.laboratory_level,
                armoryLevel: baseData.armory_level,
                storedEnergy: parseFloat(baseData.stored_energy),
                maxEnergy: parseFloat(baseData.max_energy),
                dailyStreak: baseData.daily_streak || 0,
                lastMinedAt: baseData.last_mined_at
            }
        });

    } catch (err) {
        await client.query('ROLLBACK');
        console.error('User auth error:', err);
        return res.status(500).json({ error: 'Server error sa user authentication.' });
    } finally {
        client.release();
    }
});

// -------------------------------------------------------------------------
// 2. Daily Login Streak & Energy Claim System (Mars Checklist)
// -------------------------------------------------------------------------
app.post('/api/user/daily-login', async (req, res) => {
    const { telegramId } = req.body;
    if (!telegramId) {
        return res.status(400).json({ error: 'Kulang ang Telegram ID para sa daily login.' });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const userResult = await client.query(`
            SELECT u.id as user_id, u.krypton_balance, 
                   COALESCE(b.daily_streak, 0) as daily_streak, 
                   b.last_login_date, b.stored_energy, b.max_energy
            FROM users u 
            JOIN bases b ON u.id = b.user_id 
            WHERE u.telegram_id = $1
        `, [telegramId]);

        if (userResult.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'User base hindi nahanap.' });
        }

        const userData = userResult.rows[0];
        const today = new Date().toISOString().slice(0, 10);
        const lastLogin = userData.last_login_date ? new Date(userData.last_login_date).toISOString().slice(0, 10) : null;

        if (lastLogin === today) {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: 'Naka-claim na ang daily reward para sa araw na ito.' });
        }

        let newStreak = 1;
        if (lastLogin) {
            const lastDate = new Date(lastLogin);
            const currentDate = new Date(today);
            const diffTime = Math.abs(currentDate - lastDate);
            const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

            if (diffDays === 1) {
                newStreak = userData.daily_streak + 1;
            } else {
                newStreak = 1;
            }
        }

        const streakBonus = 0.05 * Math.min(newStreak, 7);

        await client.query(`UPDATE users SET krypton_balance = krypton_balance + $1 WHERE id = $2`, [streakBonus, userData.user_id]);
        await client.query(`
            UPDATE bases 
            SET daily_streak = $1, last_login_date = CURRENT_TIMESTAMP, stored_energy = max_energy 
            WHERE user_id = $2
        `, [newStreak, userData.user_id]);

        await client.query('COMMIT');
        return res.json({
            success: true,
            newStreak,
            rewardEarned: streakBonus,
            message: `Matagumpay ang Day ${newStreak} check-in! Nakatanggap ng ${streakBonus} Krypton at puno na muli ang Energy.`
        });

    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Daily login error:', err);
        return res.status(500).json({ error: 'Server error sa daily login.' });
    } finally {
        client.release();
    }
});

// -------------------------------------------------------------------------
// 3. 4-Hour Mining & Resource Claiming Endpoint
// -------------------------------------------------------------------------
app.post('/api/base/claim-mining', async (req, res) => {
    const { telegramId } = req.body;
    if (!telegramId) return res.status(400).json({ error: 'Mawawalang Telegram ID.' });

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const query = `
            SELECT u.id as user_id, u.krypton_balance, b.farm_dome_level, b.last_mined_at 
            FROM users u JOIN bases b ON u.id = b.user_id 
            WHERE u.telegram_id = $1
        `;
        const result = await client.query(query, [telegramId]);
        if (result.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'Hindi nahanap ang base ng user.' });
        }

        const { user_id, krypton_balance, farm_dome_level, last_mined_at } = result.rows[0];
        const now = new Date();
        const elapsedSeconds = (now - new Date(last_mined_at)) / 1000;
        const requiredCycleSeconds = 4 * 3600;

        if (elapsedSeconds < requiredCycleSeconds) {
            await client.query('ROLLBACK');
            return res.status(400).json({ 
                error: 'Hindi pa tapos ang mining cycle.', 
                remainingSeconds: Math.ceil(requiredCycleSeconds - elapsedSeconds) 
            });
        }

        const rewardRates = { 1: 0.05, 2: 0.12, 3: 0.25, 4: 0.50, 5: 1.00 };
        const earnedKrypton = rewardRates[farm_dome_level] || 0.05;

        await client.query(`UPDATE users SET krypton_balance = krypton_balance + $1 WHERE id = $2`, [earnedKrypton, user_id]);
        await client.query(`UPDATE bases SET last_mined_at = CURRENT_TIMESTAMP WHERE user_id = $1`, [user_id]);

        await client.query('COMMIT');
        return res.json({ 
            success: true, 
            earnedKrypton, 
            newBalance: parseFloat(krypton_balance) + earnedKrypton,
            message: `Matagumpay na nakolekta ang ${earnedKrypton} Krypton!`
        });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Mining claim error:', err);
        return res.status(500).json({ error: 'Server error sa mining.' });
    } finally {
        client.release();
    }
});

// -------------------------------------------------------------------------
// 4. Infrastructure Upgrade Endpoint (Token Sinks)
// -------------------------------------------------------------------------
app.post('/api/base/upgrade', async (req, res) => {
    const { telegramId, buildingType } = req.body;
    if (!telegramId || !buildingType) return res.status(400).json({ error: 'Kulang ang parameters.' });

    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const userResult = await client.query(`
            SELECT u.id as user_id, u.krypton_balance, b.farm_dome_level, b.factory_level, b.laboratory_level, b.armory_level 
            FROM users u JOIN bases b ON u.id = b.user_id WHERE u.telegram_id = $1
        `, [telegramId]);

        if (userResult.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'User base not found.' });
        }

        const userData = userResult.rows[0];
        const levels = { farm_dome: userData.farm_dome_level, factory: userData.factory_level, laboratory: userData.laboratory_level, armory: userData.armory_level };
        const currentLevel = levels[buildingType];

        if (!currentLevel || currentLevel >= 5) {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: 'Invalid building o max level na.' });
        }

        const upgradeCosts = { 1: 2, 2: 5, 3: 12, 4: 25 };
        const upgradeHours = { 1: 1, 2: 4, 3: 12, 4: 24 };
        const requiredKrypton = upgradeCosts[currentLevel];
        const hoursToComplete = upgradeHours[currentLevel];

        if (parseFloat(userData.krypton_balance) < requiredKrypton) {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: 'Kulang ang Krypton balance mo para sa upgrade na ito.' });
        }

        await client.query(`UPDATE users SET krypton_balance = krypton_balance - $1 WHERE id = $2`, [requiredKrypton, userData.user_id]);
        
        const finishesAt = new Date(Date.now() + hoursToComplete * 3600 * 1000);
        await client.query(`
            INSERT INTO construction_queues (user_id, building_type, target_level, krypton_cost, finishes_at) 
            VALUES ($1, $2, $3, $4, $5)
        `, [userData.user_id, buildingType, currentLevel + 1, requiredKrypton, finishesAt]);

        await client.query('COMMIT');
        return res.json({ 
            success: true, 
            message: `Upgrade sa ${buildingType} patungong Level ${currentLevel + 1} ay sinimulan!`, 
            finishesAt,
            timerHours: hoursToComplete
        });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Building upgrade error:', err);
        return res.status(500).json({ error: 'Server error sa upgrade.' });
    } finally {
        client.release();
    }
});

// -------------------------------------------------------------------------
// 5. AdsGram Reward Callback Endpoint (Ads Engagement Bonus)
// -------------------------------------------------------------------------
app.post('/api/ads/reward-callback', async (req, res) => {
    const { telegramId, sessionId, rewardType } = req.body;
    if (!telegramId || !rewardType) return res.status(400).json({ error: 'Kulang ang parameters para sa ad reward.' });

    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const userResult = await client.query(`SELECT id, krypton_balance FROM users WHERE telegram_id = $1`, [telegramId]);
        if (userResult.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'User hindi nahanap.' });
        }

        const userId = userResult.rows[0].id;
        const currentBalance = parseFloat(userResult.rows[0].krypton_balance);

        if (rewardType === 'KRYPTON_BOOST') {
            const adBonus = 0.10;
            await client.query(`UPDATE users SET krypton_balance = krypton_balance + $1 WHERE id = $2`, [adBonus, userId]);
            await client.query(`INSERT INTO ad_reward_logs (user_id, session_id, reward_type) VALUES ($1, $2, $3)`, [userId, sessionId || 'direct_adsgram', rewardType]);
            await client.query('COMMIT');
            return res.json({ 
                success: true, 
                reward: adBonus, 
                newBalance: currentBalance + adBonus,
                message: 'Matagumpay na naidagdag ang 0.10 Krypton mula sa Ad Transmission!'
            });
        } else if (rewardType === 'ENERGY_REFILL') {
            await client.query(`UPDATE bases SET stored_energy = max_energy WHERE user_id = $1`, [userId]);
            await client.query(`INSERT INTO ad_reward_logs (user_id, session_id, reward_type) VALUES ($1, $2, $3)`, [userId, sessionId || 'direct_adsgram', rewardType]);
            await client.query('COMMIT');
            return res.json({ 
                success: true, 
                message: 'Puno na muli ang Energy ng iyong base mula sa Ad transmission!' 
            });
        } else {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: 'Invalid reward type.' });
        }
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Ad reward error:', err);
        return res.status(500).json({ error: 'Server error sa ad reward.' });
    } finally {
        client.release();
    }
});

// -------------------------------------------------------------------------
// 6. Prediction Market & Betting Endpoint (Martian Price Predictions)
// -------------------------------------------------------------------------
app.post('/api/prediction/place-bet', async (req, res) => {
    const { telegramId, asset, direction, stakeAmount, roundDurationMinutes } = req.body;

    if (!telegramId || !asset || !direction || !stakeAmount) {
        return res.status(400).json({ error: 'Kulang ang kinakailangang mga parameter para sa prediction bet.' });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const userResult = await client.query(`SELECT id, krypton_balance FROM users WHERE telegram_id = $1`, [telegramId]);
        if (userResult.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'Hindi nahanap ang user para sa prediction.' });
        }

        const userId = userResult.rows[0].id;
        const currentBalance = parseFloat(userResult.rows[0].krypton_balance);

        if (currentBalance < stakeAmount) {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: 'Kulang ang iyong Krypton balance para ilagay ang bet na ito.' });
        }

        await client.query(`UPDATE users SET krypton_balance = krypton_balance - $1 WHERE id = $2`, [stakeAmount, userId]);

        const lockedUntil = new Date(Date.now() + (roundDurationMinutes || 15) * 60 * 1000);
        
        await client.query(`
            CREATE TABLE IF NOT EXISTS prediction_bets (
                id SERIAL PRIMARY KEY,
                user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
                asset VARCHAR(20) NOT NULL,
                direction VARCHAR(10) NOT NULL,
                stake_amount NUMERIC(18, 9) NOT NULL,
                status VARCHAR(20) DEFAULT 'ACTIVE',
                locked_until TIMESTAMP NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        await client.query(`
            INSERT INTO prediction_bets (user_id, asset, direction, stake_amount, locked_until)
            VALUES ($1, $2, $3, $4, $5)
        `, [userId, asset, direction.toUpperCase(), stakeAmount, lockedUntil]);

        await client.query('COMMIT');

        return res.json({
            success: true,
            message: `Matagumpay na nailagay ang ${stakeAmount} KRT bet para sa ${asset.toUpperCase()} (${direction.toUpperCase()})!`,
            newBalance: currentBalance - stakeAmount,
            lockedUntil
        });

    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Prediction bet error:', err);
        return res.status(500).json({ error: 'May naganap na error sa server habang naglalagay ng bet.' });
    } finally {
        client.release();
    }
});

// -------------------------------------------------------------------------
// 7. Prediction Round Settlement Endpoint (Time-Weighted Payouts)
// -------------------------------------------------------------------------
app.post('/api/prediction/settle-round', async (req, res) => {
    const { roundId, finalPrice, startPrice } = req.body;

    if (finalPrice === undefined || startPrice === undefined) {
        return res.status(400).json({ error: 'Kulang ang parameters para sa round settlement.' });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        let roundResult = 'FLAT';
        if (finalPrice > startPrice) roundResult = 'UP';
        else if (finalPrice < startPrice) roundResult = 'DOWN';

        const betsResult = await client.query(`
            SELECT id, user_id, direction, stake_amount, created_at 
            FROM prediction_bets 
            WHERE status = 'ACTIVE'
        `);

        const bets = betsResult.rows;
        let totalWinningPool = 0;
        let totalLosingPool = 0;

        const processedBets = bets.map(bet => {
            let isWin = false;
            if (roundResult !== 'FLAT') {
                isWin = bet.direction === roundResult;
            }
            return { ...bet, isWin };
        });

        processedBets.forEach(bet => {
            const stake = parseFloat(bet.stake_amount);
            if (bet.isWin) totalWinningPool += stake;
            else totalLosingPool += stake;
        });

        for (const bet of processedBets) {
            const stake = parseFloat(bet.stake_amount);

            if (roundResult === 'FLAT') {
                await client.query(`UPDATE users SET krypton_balance = krypton_balance + $1 WHERE id = $2`, [stake, bet.user_id]);
                await client.query(`UPDATE prediction_bets SET status = 'REFUNDED' WHERE id = $1`, [bet.id]);
            } else if (bet.isWin) {
                const netLosingPool = totalLosingPool * 0.95;
                const winShare = totalWinningPool > 0 ? (stake / totalWinningPool) * netLosingPool : 0;
                const totalPayout = stake + winShare;

                await client.query(`UPDATE users SET krypton_balance = krypton_balance + $1 WHERE id = $2`, [totalPayout, bet.user_id]);
                await client.query(`UPDATE prediction_bets SET status = 'WON' WHERE id = $1`, [bet.id]);
            } else {
                await client.query(`UPDATE prediction_bets SET status = 'LOST' WHERE id = $1`, [bet.id]);
            }
        }

        await client.query('COMMIT');
        return res.json({
            success: true,
            roundResult,
            totalWinningPool,
            totalLosingPool,
            message: `Matagumpay na na-settle ang round. Resulta: ${roundResult}`
        });

    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Round settlement error:', err);
        return res.status(500).json({ error: 'Server error sa pag-settle ng prediction round.' });
    } finally {
        client.release();
    }
});

// -------------------------------------------------------------------------
// 8. TON Connect Wallet Link Endpoint (On-Chain Integration)
// -------------------------------------------------------------------------
app.post('/api/user/connect-wallet', async (req, res) => {
    const { telegramId, walletAddress } = req.body;
    if (!telegramId || !walletAddress) {
        return res.status(400).json({ error: 'Kulang ang Telegram ID o Wallet Address para sa TON Connect.' });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const userResult = await client.query(`SELECT id FROM users WHERE telegram_id = $1`, [telegramId]);
        if (userResult.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'Hindi nahanap ang user base.' });
        }

        const userId = userResult.rows[0].id;

        await client.query(`
            ALTER TABLE users ADD COLUMN IF NOT EXISTS ton_wallet_address VARCHAR(255)
        `);

        await client.query(`
            UPDATE users SET ton_wallet_address = $1 WHERE id = $2
        `, [walletAddress, userId]);

        await client.query('COMMIT');
        return res.json({
            success: true,
            walletAddress,
            message: 'Matagumpay na na-link ang iyong TON Wallet sa iyong Martian account!'
        });

    } catch (err) {
        await client.query('ROLLBACK');
        console.error('TON wallet connect error:', err);
        return res.status(500).json({ error: 'Server error sa pag-link ng wallet.' });
    } finally {
        client.release();
    }
});

// -------------------------------------------------------------------------
// Server Listener Start
// -------------------------------------------------------------------------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Martian Backend running on port ${PORT}`));