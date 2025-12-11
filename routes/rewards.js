const express = require('express');
const router = express.Router();

// This will be injected from server.js
let helpers = null;

function initRewardsRoutes(deps) {
    helpers = deps;
    return router;
}

// ============================================
// REWARDS DATA API
// ============================================

/**
 * @swagger
 * /api/rewards:
 *   get:
 *     summary: Get rewards history
 *     tags: [Rewards]
 *     parameters:
 *       - in: query
 *         name: month
 *         schema: { type: integer }
 *         description: Month (1-12)
 *       - in: query
 *         name: year
 *         schema: { type: integer }
 *         description: Year (e.g., 2024)
 *       - in: query
 *         name: all
 *         schema: { type: boolean }
 *         description: Get all records (ignore month filter)
 *       - in: query
 *         name: customerId
 *         schema: { type: string }
 *       - in: query
 *         name: type
 *         schema: { type: string }
 *         description: Sheet type (transactions, load, flyy_points)
 *     responses:
 *       200:
 *         description: Rewards history
 */
router.get('/', async (req, res) => {
    try {
        const { customerId, type } = req.query;
        const { month, year, all } = helpers.getMonthFilter(req.query);

        // Get all sheet names
        const sheetNames = await helpers.getSheetNames(helpers.EXCEL_FILES.rewards);

        // Read all sheets
        let response = {};
        for (const sheetName of sheetNames) {
            let sheetData = await helpers.readExcelSheet(helpers.EXCEL_FILES.rewards, sheetName);

            // Apply month filter (default: current month) unless all=true
            if (!all) {
                const dateField = sheetName === 'Flyy points' ? 'Created_At' : 'Txn_Date';
                sheetData = sheetData.filter(item => helpers.isDateInMonth(item[dateField], month, year));
            }

            // Apply customerId filter
            if (customerId) {
                sheetData = sheetData.filter(item => item.customerId == customerId);
            }

            // Normalize sheet name for response key
            const key = sheetName.toLowerCase().replace(/\s+/g, '_');
            response[key] = sheetData;
        }

        // Filter by type if specified
        if (type) {
            const typeKey = type.toLowerCase().replace(/\s+/g, '_');
            if (response[typeKey]) {
                response = { [typeKey]: response[typeKey] };
            }
        }

        // Calculate totals and stats per sheet
        let totalRecords = 0;
        let sheetSummaries = {};
        Object.entries(response).forEach(([key, arr]) => {
            totalRecords += arr.length;
            // Calculate stats for each sheet based on its fields
            const amountField = key === 'flyy_points' ? 'Points' : ['BHD_Amount', 'Amount', 'Txn_Amt', 'amount'];
            sheetSummaries[key] = helpers.calculateStats(arr, amountField);
        });

        res.json({
            success: true,
            message: "Rewards history fetched successfully",
            filter_period: all ? 'All Time' : `${helpers.getMonthName(month)} ${year}`,
            month: all ? null : month,
            year: all ? null : year,
            sheets: Object.keys(response),
            total_records: totalRecords,
            summary: sheetSummaries,
            data: response
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: "Error fetching rewards data",
            error: error.message
        });
    }
});

// ============================================
// MCP REWARDS ENDPOINTS
// ============================================

/**
 * @swagger
 * /api/mcp/rewards/summary:
 *   get:
 *     summary: Get rewards summary
 *     tags: [Rewards MCP]
 *     parameters:
 *       - in: query
 *         name: type
 *         schema: { type: string }
 *         description: Sheet type (transactions, load, flyy_points, or all for combined)
 *       - in: query
 *         name: period
 *         schema: { type: string }
 *         description: Time period filter
 *     responses:
 *       200:
 *         description: Points and cashback summary
 */
router.get('/mcp/summary', async (req, res) => {
    try {
        const { type, period } = req.query;
        const dateRange = helpers.parsePeriod(period);

        // Get all sheet names from rewards file
        const sheetNames = await helpers.getSheetNames(helpers.EXCEL_FILES.rewards);
        
        // Map type parameter to sheet name
        const typeToSheet = {
            'transactions': 'Transactions',
            'load': 'Load',
            'flyy_points': 'Flyy points',
            'flyypoints': 'Flyy points'
        };

        let sheetsToRead = sheetNames;
        if (type && type.toLowerCase() !== 'all') {
            const targetSheet = typeToSheet[type.toLowerCase()];
            if (targetSheet && sheetNames.includes(targetSheet)) {
                sheetsToRead = [targetSheet];
            }
        }

        let totalPoints = 0;
        let totalCashback = 0;
        let totalTransactions = 0;
        let totalLoad = 0;
        let recordCount = 0;

        // Read and process each sheet
        for (const sheetName of sheetsToRead) {
            let sheetData = await helpers.readExcelSheet(helpers.EXCEL_FILES.rewards, sheetName);
            
            // Apply date filter if period specified
            if (dateRange.start || dateRange.end) {
                const dateField = sheetName === 'Flyy points' ? 'Created_At' : 'Txn_Date';
                sheetData = sheetData.filter(item => {
                    const date = helpers.parseDate(item[dateField]);
                    if (!date) return false;
                    if (dateRange.start && date < dateRange.start) return false;
                    if (dateRange.end && date > dateRange.end) return false;
                    return true;
                });
            }
            
            recordCount += sheetData.length;

            sheetData.forEach(r => {
                const sheetKey = sheetName.toLowerCase();
                
                if (sheetKey.includes('flyy') || sheetKey.includes('points')) {
                    const points = helpers.parseAmount(r.Points || 0);
                    totalPoints += points;
                } else if (sheetKey.includes('load')) {
                    const amt = helpers.parseAmount(r.BHD_Amount || r.Amount || r.amount || 0);
                    totalLoad += amt;
                } else if (sheetKey.includes('transaction')) {
                    const amt = helpers.parseAmount(r.BHD_Amount || r.Amount || r.amount || 0);
                    totalTransactions += amt;
                    totalCashback += amt;
                }
            });
        }

        // Build response based on type
        let response = {
            success: true,
            tool: 'rewards_summary',
            type: type || 'all',
            period: dateRange.label,
            record_count: recordCount
        };

        if (!type || type.toLowerCase() === 'all') {
            response.summary = {
                total_points: Math.round(totalPoints),
                total_cashback_bhd: Math.round(totalCashback * 100) / 100,
                total_load_bhd: Math.round(totalLoad * 100) / 100,
                total_transactions_bhd: Math.round(totalTransactions * 100) / 100
            };
            response.tier = totalPoints > 10000 ? 'Platinum' : (totalPoints > 5000 ? 'Gold' : 'Silver');
            response.next_tier_progress = 75;
        } else if (type.toLowerCase() === 'flyy_points' || type.toLowerCase() === 'flyypoints') {
            response.summary = {
                total_points: Math.round(totalPoints),
                tier: totalPoints > 10000 ? 'Platinum' : (totalPoints > 5000 ? 'Gold' : 'Silver'),
                next_tier_progress: 75
            };
        } else if (type.toLowerCase() === 'load') {
            response.summary = {
                total_load_bhd: Math.round(totalLoad * 100) / 100,
                transaction_count: recordCount
            };
        } else if (type.toLowerCase() === 'transactions') {
            response.summary = {
                total_transactions_bhd: Math.round(totalTransactions * 100) / 100,
                total_cashback_bhd: Math.round(totalCashback * 100) / 100,
                transaction_count: recordCount
            };
        }

        res.json(response);
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * @swagger
 * /api/mcp/rewards/activity:
 *   get:
 *     summary: Get rewards activity history
 *     tags: [Rewards MCP]
 *     parameters:
 *       - in: query
 *         name: type
 *         schema: { type: string }
 *         description: Sheet type (transactions, load, flyy_points, or all for combined)
 *       - in: query
 *         name: period
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: History of earned rewards
 */
router.get('/mcp/activity', async (req, res) => {
    try {
        const { type, period } = req.query;
        const dateRange = helpers.parsePeriod(period);

        // Get all sheet names from rewards file
        const sheetNames = await helpers.getSheetNames(helpers.EXCEL_FILES.rewards);
        
        // Map type parameter to sheet name
        const typeToSheet = {
            'transactions': 'Transactions',
            'load': 'Load',
            'flyy_points': 'Flyy points',
            'flyypoints': 'Flyy points'
        };

        let sheetsToRead = sheetNames;
        if (type && type.toLowerCase() !== 'all') {
            const targetSheet = typeToSheet[type.toLowerCase()];
            if (targetSheet && sheetNames.includes(targetSheet)) {
                sheetsToRead = [targetSheet];
            }
        }

        // Helper to format date properly
        const formatDate = (rawDate) => {
            const date = helpers.parseDate(rawDate);
            if (!date || isNaN(date.getTime())) return null;
            const pad = (n) => String(n).padStart(2, '0');
            return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
        };

        let allActivity = [];

        // Read and process each sheet
        for (const sheetName of sheetsToRead) {
            let sheetData = await helpers.readExcelSheet(helpers.EXCEL_FILES.rewards, sheetName);
            const sheetKey = sheetName.toLowerCase().replace(/\s+/g, '_');
            
            // Apply date filter
            const dateField = sheetName === 'Flyy points' ? 'Created_At' : 'Txn_Date';
            sheetData = sheetData.filter(item => {
                const date = helpers.parseDate(item[dateField]);
                if (!date) return false;
                if (dateRange.start && date < dateRange.start) return false;
                if (dateRange.end && date > dateRange.end) return false;
                return true;
            });

            // Map to standard format
            sheetData.forEach(r => {
                const rawDate = r.Created_At || r.Txn_Date || r.Date || r.timestamp;
                let activityType = 'Cashback';
                let amount = 0;
                let description = '';

                if (sheetKey.includes('flyy') || sheetKey.includes('points')) {
                    activityType = 'Points';
                    amount = helpers.parseAmount(r.Points || 0);
                    description = r.Message || r.Description || 'Points Activity';
                } else if (sheetKey.includes('load')) {
                    activityType = 'Load';
                    amount = helpers.parseAmount(r.BHD_Amount || r.Amount || r.amount || 0);
                    description = r.description || r.transactionType_dsc || 'Wallet Load';
                } else {
                    activityType = 'Transaction';
                    amount = helpers.parseAmount(r.BHD_Amount || r.Amount || r.amount || 0);
                    description = r.otherPartyName || r.MCC_Name || r.transactionType_dsc || 'Card Transaction';
                }

                allActivity.push({
                    date: formatDate(rawDate) || rawDate,
                    sheet_type: sheetKey,
                    type: activityType,
                    description: description,
                    amount: amount,
                    currency: sheetKey.includes('flyy') ? 'Points' : 'BHD'
                });
            });
        }

        // Sort by date descending
        allActivity.sort((a, b) => {
            const dateA = helpers.parseDate(a.date);
            const dateB = helpers.parseDate(b.date);
            return (dateB || 0) - (dateA || 0);
        });

        res.json({
            success: true,
            tool: 'rewards_activity',
            type: type || 'all',
            period: dateRange.label,
            count: allActivity.length,
            activity: allActivity.slice(0, 50)
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * @swagger
 * /api/mcp/rewards/expiry-alerts:
 *   get:
 *     summary: Get expiring rewards alerts
 *     tags: [Rewards MCP]
 *     responses:
 *       200:
 *         description: List of expiring points
 */
router.get('/mcp/expiry-alerts', async (req, res) => {
    try {
        // Mock logic: 10% of total points expiring in 30 days
        const rewards = await helpers.getMcpData('rewards');

        const expiringPoints = [];
        // Add a mock expiring item
        expiringPoints.push({
            amount: 500,
            expiry_date: new Date(Date.now() + 15 * 24 * 60 * 60 * 1000).toISOString().split('T')[0], // 15 days from now
            description: "Promotional Bonus Points"
        });

        res.json({
            success: true,
            tool: 'rewards_expiry',
            alerts: expiringPoints
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * @swagger
 * /api/mcp/rewards/best-strategy:
 *   get:
 *     summary: Get best rewards strategy for a category
 *     tags: [Rewards MCP]
 *     parameters:
 *       - in: query
 *         name: category
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Recommendation for maximizing rewards
 */
router.get('/mcp/best-strategy', async (req, res) => {
    try {
        const { category } = req.query;
        // Mock rules engine
        const rules = {
            'dining': "Use your Platinum Card for 5x points on dining.",
            'grocery': "Use Gold Card for 3% cashback at supermarkets.",
            'travel': "Book via the portal for 10x points on hotels.",
            'fuel': "Use Debit Card for 2% instant cashback."
        };

        const rec = rules[(category || '').toLowerCase()] || "Use your Platinum Card for 1.5x points on general spend.";

        res.json({
            success: true,
            tool: 'rewards_strategy',
            category: category || 'General',
            recommendation: rec
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = initRewardsRoutes;
