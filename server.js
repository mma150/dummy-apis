const express = require('express');
const XlsxPopulate = require('xlsx-populate');
const path = require('path');
const redis = require('redis');
const app = express();
const PORT = process.env.PORT || 9191;

app.use(express.json());

// Excel password
const EXCEL_PASSWORD = 'BFCxMobi@2468';

// Redis configuration
const REDIS_URL = process.env.REDIS_URL || 'redis://45.194.3.171:6379';
const REDIS_DB = 0; // Database index for dummy-apis
const CACHE_EXPIRY = 60 * 24 * 60 * 60; // 2 months (60 days) in seconds

// Create Redis client
const redisClient = redis.createClient({
    url: REDIS_URL,
    database: REDIS_DB
});

// Redis connection handling
redisClient.on('error', (err) => console.error('Redis Client Error:', err));
redisClient.on('connect', () => console.log('Redis Client Connected'));
redisClient.on('ready', () => console.log('Redis Client Ready'));

// Connect to Redis
(async () => {
    try {
        await redisClient.connect();
        console.log(`Connected to Redis at ${REDIS_URL}, DB: ${REDIS_DB}`);
    } catch (err) {
        console.error('Failed to connect to Redis:', err.message);
        console.log('Server will continue without caching');
    }
})();

// Excel file paths
const EXCEL_FILES = {
    remittance: path.join(__dirname, "remittance.xlsx"),
    transactions: path.join(__dirname, "transactions.xlsx"),
    rewards: path.join(__dirname, "rewardhistory.xlsx"),
    travelbuddy: path.join(__dirname, "travelbuddytxn.xlsx")
};

// ============================================
// HELPER FUNCTIONS
// ============================================

// Generate cache key based on month-year-sheetName pattern
function generateCacheKey(prefix, month, year, sheetName = 'default', additionalParams = {}) {
    const baseKey = `dummy-apis:${prefix}:${year}-${month}:${sheetName}`;
    const paramStr = Object.keys(additionalParams)
        .filter(k => additionalParams[k] !== undefined && additionalParams[k] !== null)
        .sort()
        .map(k => `${k}=${additionalParams[k]}`)
        .join(':');
    return paramStr ? `${baseKey}:${paramStr}` : baseKey;
}

// Get data from cache
async function getFromCache(key) {
    try {
        if (!redisClient.isOpen) return null;
        const data = await redisClient.get(key);
        if (data) {
            console.log(`Cache HIT: ${key}`);
            return JSON.parse(data);
        }
        console.log(`Cache MISS: ${key}`);
        return null;
    } catch (err) {
        console.error('Redis get error:', err.message);
        return null;
    }
}

// Set data to cache with 2-month expiration
async function setToCache(key, data) {
    try {
        if (!redisClient.isOpen) return false;
        await redisClient.setEx(key, CACHE_EXPIRY, JSON.stringify(data));
        console.log(`Cache SET: ${key} (expires in 2 months)`);
        return true;
    } catch (err) {
        console.error('Redis set error:', err.message);
        return false;
    }
}

// Clear cache by pattern
async function clearCacheByPattern(pattern) {
    try {
        if (!redisClient.isOpen) return false;
        const keys = await redisClient.keys(pattern);
        if (keys.length > 0) {
            await redisClient.del(keys);
            console.log(`Cleared ${keys.length} cache keys matching: ${pattern}`);
        }
        return true;
    } catch (err) {
        console.error('Redis clear error:', err.message);
        return false;
    }
}

// Parse JSON fields safely
function parseJsonField(value) {
    if (!value) return null;
    if (typeof value === 'object') return value;
    try {
        return JSON.parse(value);
    } catch (e) {
        return value;
    }
}

// Parse date from various formats
function parseDate(dateStr) {
    if (!dateStr) return null;
    
    // If it's a number (Excel serial date)
    if (typeof dateStr === 'number') {
        const utc_days = Math.floor(dateStr - 25569);
        const date = new Date(utc_days * 86400 * 1000);
        return date;
    }
    
    // Try parsing string date formats
    // Format: "Nov 27, 2024, 5:06 PM"
    // Format: "2025-01-01 10:00:19"
    // Format: "14/11/2025 07:25:18"
    
    let date = new Date(dateStr);
    if (!isNaN(date.getTime())) return date;
    
    // Try DD/MM/YYYY format
    const ddmmyyyy = dateStr.match(/(\d{2})\/(\d{2})\/(\d{4})\s*(\d{2}):(\d{2}):(\d{2})?/);
    if (ddmmyyyy) {
        const [, day, month, year, hour, min, sec = '00'] = ddmmyyyy;
        return new Date(year, month - 1, day, hour, min, sec);
    }
    
    return null;
}

// Check if date is within range
function isDateInRange(dateStr, startDate, endDate) {
    const date = parseDate(dateStr);
    if (!date) return true; // Include if date can't be parsed
    
    const start = startDate ? new Date(startDate) : null;
    const end = endDate ? new Date(endDate) : null;
    
    if (start) start.setHours(0, 0, 0, 0);
    if (end) end.setHours(23, 59, 59, 999);
    
    if (start && date < start) return false;
    if (end && date > end) return false;
    return true;
}

// Check if date is in specific month/year
function isDateInMonth(dateStr, month, year) {
    const date = parseDate(dateStr);
    if (!date) return false; // Exclude if date can't be parsed
    
    return date.getMonth() + 1 === parseInt(month) && date.getFullYear() === parseInt(year);
}

// Get default month filter (current month) or from query params
function getMonthFilter(query) {
    const now = new Date();
    const month = query.month || (now.getMonth() + 1); // 1-12
    const year = query.year || now.getFullYear();
    const all = query.all === 'true'; // If all=true, return all data
    
    return { month: parseInt(month), year: parseInt(year), all };
}

// Get month name from number
function getMonthName(monthNum) {
    const months = ['January', 'February', 'March', 'April', 'May', 'June', 
                    'July', 'August', 'September', 'October', 'November', 'December'];
    return months[monthNum - 1] || 'Unknown';
}

// Calculate statistics for an array of data
function calculateStats(data, amountFields) {
    if (!data || data.length === 0) {
        return {
            count: 0,
            total_amount: 0,
            max_amount: 0,
            min_amount: 0,
            average_amount: 0
        };
    }
    
    // Find the amount field that exists in the data
    const fields = Array.isArray(amountFields) ? amountFields : [amountFields];
    let amountField = null;
    for (const field of fields) {
        if (data[0] && data[0][field] !== undefined) {
            amountField = field;
            break;
        }
    }
    
    if (!amountField) {
        return {
            count: data.length,
            total_amount: null,
            max_amount: null,
            min_amount: null,
            average_amount: null,
            note: 'Amount field not found in data'
        };
    }
    
    const amounts = data
        .map(item => parseFloat(item[amountField]) || 0)
        .filter(amt => !isNaN(amt));
    
    if (amounts.length === 0) {
        return {
            count: data.length,
            total_amount: 0,
            max_amount: 0,
            min_amount: 0,
            average_amount: 0,
            amount_field: amountField
        };
    }
    
    const total = amounts.reduce((sum, amt) => sum + amt, 0);
    const max = Math.max(...amounts);
    const min = Math.min(...amounts);
    const avg = total / amounts.length;
    
    return {
        count: data.length,
        total_amount: Math.round(total * 100) / 100,
        max_amount: Math.round(max * 100) / 100,
        min_amount: Math.round(min * 100) / 100,
        average_amount: Math.round(avg * 100) / 100,
        amount_field: amountField
    };
}

// Read Excel sheet and convert to JSON array
async function readExcelSheet(filePath, sheetName = null) {
    try {
        const workbook = await XlsxPopulate.fromFileAsync(filePath, { password: EXCEL_PASSWORD });
        const sheet = sheetName ? workbook.sheet(sheetName) : workbook.sheet(0);
        
        if (!sheet) {
            throw new Error(`Sheet "${sheetName}" not found`);
        }
        
        const usedRange = sheet.usedRange();
        if (!usedRange) return [];
        
        const data = usedRange.value();
        if (!data || data.length < 2) return [];
        
        const headers = data[0];
        const rows = data.slice(1);
        
        return rows.map(row => {
            const obj = {};
            headers.forEach((header, index) => {
                if (header) {
                    let value = row[index];
                    // Try to parse JSON fields
                    if (typeof value === 'string' && (value.startsWith('{') || value.startsWith('['))) {
                        value = parseJsonField(value);
                    }
                    // Normalize header names (remove spaces, handle duplicates)
                    const normalizedHeader = header.replace(/\s+/g, '_').replace(/\//g, '_');
                    obj[normalizedHeader] = value !== undefined ? value : null;
                }
            });
            return obj;
        });
    } catch (error) {
        console.error(`Error reading Excel file ${filePath}:`, error.message);
        throw error;
    }
}

// Get all sheet names from an Excel file
async function getSheetNames(filePath) {
    try {
        const workbook = await XlsxPopulate.fromFileAsync(filePath, { password: EXCEL_PASSWORD });
        return workbook.sheets().map(sheet => sheet.name());
    } catch (error) {
        console.error(`Error getting sheet names from ${filePath}:`, error.message);
        throw error;
    }
}

// ============================================
// API ENDPOINTS
// ============================================

// 1. Remittance History API
app.get('/api/remittance', async (req, res) => {
    try {
        const { cpr, paymentmode, status } = req.query;
        const { month, year, all } = getMonthFilter(req.query);
        
        // Generate cache key
        const cacheKey = generateCacheKey('remittance', month, year, 'default', { cpr, paymentmode, status, all: all ? 'true' : 'false' });
        
        // Try to get from cache
        const cachedData = await getFromCache(cacheKey);
        if (cachedData) {
            return res.json({ ...cachedData, cached: true });
        }
        
        // Read data from Excel file
        let data = await readExcelSheet(EXCEL_FILES.remittance);
        
        // Apply month filter (default: current month) unless all=true
        if (!all) {
            data = data.filter(item => isDateInMonth(item.timestamp_created, month, year));
        }
        
        // Apply filters
        if (cpr) {
            data = data.filter(item => item.cpr == cpr);
        }
        if (paymentmode) {
            data = data.filter(item => 
                item.paymentmode && item.paymentmode.toLowerCase().includes(paymentmode.toLowerCase())
            );
        }
        if (status !== undefined) {
            data = data.filter(item => item.status === (status === 'true'));
        }
        
        // Calculate statistics
        const stats = calculateStats(data, ['total_amount_in_BHD', 'amount']);
        
        const responseData = {
            success: true,
            message: "Remittance history fetched successfully",
            filter_period: all ? 'All Time' : `${getMonthName(month)} ${year}`,
            month: all ? null : month,
            year: all ? null : year,
            total_records: data.length,
            summary: stats,
            data: data
        };
        
        // Store in cache
        await setToCache(cacheKey, responseData);
        
        res.json({ ...responseData, cached: false });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: "Error fetching remittance data",
            error: error.message
        });
    }
});

// 2. Transactions History API
app.get('/api/transactions', async (req, res) => {
    try {
        const { sender_cr, transaction_type, transaction_status, credit_debit } = req.query;
        const { month, year, all } = getMonthFilter(req.query);
        
        // Generate cache key
        const cacheKey = generateCacheKey('transactions', month, year, 'default', { sender_cr, transaction_type, transaction_status, credit_debit, all: all ? 'true' : 'false' });
        
        // Try to get from cache
        const cachedData = await getFromCache(cacheKey);
        if (cachedData) {
            return res.json({ ...cachedData, cached: true });
        }
        
        // Read data from Excel file
        let data = await readExcelSheet(EXCEL_FILES.transactions);
        
        // Apply month filter (default: current month) unless all=true
        if (!all) {
            data = data.filter(item => isDateInMonth(item.transaction_date_time || item.created_date, month, year));
        }
        
        // Apply filters
        if (sender_cr) {
            data = data.filter(item => item.sender_cr == sender_cr);
        }
        if (transaction_type) {
            data = data.filter(item => 
                item.transaction_type && item.transaction_type.toLowerCase().includes(transaction_type.toLowerCase())
            );
        }
        if (transaction_status) {
            data = data.filter(item => 
                item.transaction_status && item.transaction_status.toLowerCase() === transaction_status.toLowerCase()
            );
        }
        if (credit_debit) {
            data = data.filter(item => 
                item.credit_debit && item.credit_debit.toLowerCase() === credit_debit.toLowerCase()
            );
        }
        
        // Calculate statistics
        const stats = calculateStats(data, ['transaction_amount', 'amount', 'Amount']);
        
        const responseData = {
            success: true,
            message: "Transaction history fetched successfully",
            filter_period: all ? 'All Time' : `${getMonthName(month)} ${year}`,
            month: all ? null : month,
            year: all ? null : year,
            total_records: data.length,
            summary: stats,
            data: data
        };
        
        // Store in cache
        await setToCache(cacheKey, responseData);
        
        res.json({ ...responseData, cached: false });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: "Error fetching transaction data",
            error: error.message
        });
    }
});

// 3. Rewards History API
app.get('/api/rewards', async (req, res) => {
    try {
        const { customerId, type } = req.query;
        const { month, year, all } = getMonthFilter(req.query);
        
        // Generate cache key
        const cacheKey = generateCacheKey('rewards', month, year, type || 'all', { customerId, all: all ? 'true' : 'false' });
        
        // Try to get from cache
        const cachedData = await getFromCache(cacheKey);
        if (cachedData) {
            return res.json({ ...cachedData, cached: true });
        }
        
        // Get all sheet names
        const sheetNames = await getSheetNames(EXCEL_FILES.rewards);
        
        // Read all sheets
        let response = {};
        for (const sheetName of sheetNames) {
            let sheetData = await readExcelSheet(EXCEL_FILES.rewards, sheetName);
            
            // Apply month filter (default: current month) unless all=true
            if (!all) {
                const dateField = sheetName === 'Flyy points' ? 'Created_At' : 'Txn_Date';
                sheetData = sheetData.filter(item => isDateInMonth(item[dateField], month, year));
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
            sheetSummaries[key] = calculateStats(arr, amountField);
        });
        
        const responseData = {
            success: true,
            message: "Rewards history fetched successfully",
            filter_period: all ? 'All Time' : `${getMonthName(month)} ${year}`,
            month: all ? null : month,
            year: all ? null : year,
            sheets: Object.keys(response),
            total_records: totalRecords,
            summary: sheetSummaries,
            data: response
        };
        
        // Store in cache
        await setToCache(cacheKey, responseData);
        
        res.json({ ...responseData, cached: false });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: "Error fetching rewards data",
            error: error.message
        });
    }
});

// 4. TravelBuddy Transaction History API
app.get('/api/travelbuddy', async (req, res) => {
    try {
        const { customerId, type, country, transactionType } = req.query;
        const { month, year, all } = getMonthFilter(req.query);
        
        // Generate cache key
        const cacheKey = generateCacheKey('travelbuddy', month, year, type || 'all', { customerId, country, transactionType, all: all ? 'true' : 'false' });
        
        // Try to get from cache
        const cachedData = await getFromCache(cacheKey);
        if (cachedData) {
            return res.json({ ...cachedData, cached: true });
        }
        
        // Get all sheet names
        const sheetNames = await getSheetNames(EXCEL_FILES.travelbuddy);
        
        // Read all sheets
        let response = {};
        for (const sheetName of sheetNames) {
            let sheetData = await readExcelSheet(EXCEL_FILES.travelbuddy, sheetName);
            
            // Apply month filter (default: current month) unless all=true
            if (!all) {
                sheetData = sheetData.filter(item => isDateInMonth(item.Txn_Date, month, year));
            }
            
            // Apply customerId filter
            if (customerId) {
                sheetData = sheetData.filter(item => item.customerId == customerId);
            }
            
            // Apply country filter (only for transaction sheets)
            if (country && sheetName.toLowerCase().includes('transaction')) {
                sheetData = sheetData.filter(item => 
                    item.country && item.country.toLowerCase().includes(country.toLowerCase())
                );
            }
            
            // Apply transactionType filter
            if (transactionType) {
                sheetData = sheetData.filter(item => 
                    item.transactionType_dsc && item.transactionType_dsc.toLowerCase() === transactionType.toLowerCase()
                );
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
            // Calculate stats for each sheet
            sheetSummaries[key] = calculateStats(arr, ['BHD_Amount', 'Txn_Amt', 'Amount', 'amount', 'txn_amt']);
        });
        
        const responseData = {
            success: true,
            message: "TravelBuddy transaction history fetched successfully",
            filter_period: all ? 'All Time' : `${getMonthName(month)} ${year}`,
            month: all ? null : month,
            year: all ? null : year,
            sheets: Object.keys(response),
            total_records: totalRecords,
            summary: sheetSummaries,
            data: response
        };
        
        // Store in cache
        await setToCache(cacheKey, responseData);
        
        res.json({ ...responseData, cached: false });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: "Error fetching TravelBuddy data",
            error: error.message
        });
    }
});

// 5. Get all data from all sheets (combined endpoint)
app.get('/api/all', async (req, res) => {
    try {
        const { month, year, all } = getMonthFilter(req.query);
        
        // Generate cache key
        const cacheKey = generateCacheKey('all', month, year, 'combined', { all: all ? 'true' : 'false' });
        
        // Try to get from cache
        const cachedData = await getFromCache(cacheKey);
        if (cachedData) {
            return res.json({ ...cachedData, cached: true });
        }
        
        const response = {
            remittance: [],
            transactions: [],
            rewards: {},
            travelbuddy: {}
        };
        
        // Read Remittance
        let remittanceData = await readExcelSheet(EXCEL_FILES.remittance);
        if (!all) {
            remittanceData = remittanceData.filter(item => isDateInMonth(item.timestamp_created, month, year));
        }
        response.remittance = remittanceData;
        
        // Read Transactions
        let transactionsData = await readExcelSheet(EXCEL_FILES.transactions);
        if (!all) {
            transactionsData = transactionsData.filter(item => isDateInMonth(item.transaction_date_time || item.created_date, month, year));
        }
        response.transactions = transactionsData;
        
        // Read Rewards (all sheets)
        const rewardsSheets = await getSheetNames(EXCEL_FILES.rewards);
        for (const sheetName of rewardsSheets) {
            const key = sheetName.toLowerCase().replace(/\s+/g, '_');
            let sheetData = await readExcelSheet(EXCEL_FILES.rewards, sheetName);
            if (!all) {
                const dateField = sheetName === 'Flyy points' ? 'Created_At' : 'Txn_Date';
                sheetData = sheetData.filter(item => isDateInMonth(item[dateField], month, year));
            }
            response.rewards[key] = sheetData;
        }
        
        // Read TravelBuddy (all sheets)
        const travelbuddySheets = await getSheetNames(EXCEL_FILES.travelbuddy);
        for (const sheetName of travelbuddySheets) {
            const key = sheetName.toLowerCase().replace(/\s+/g, '_');
            let sheetData = await readExcelSheet(EXCEL_FILES.travelbuddy, sheetName);
            if (!all) {
                sheetData = sheetData.filter(item => isDateInMonth(item.Txn_Date, month, year));
            }
            response.travelbuddy[key] = sheetData;
        }
        
        // Calculate totals
        let totalRecords = response.remittance.length + response.transactions.length;
        Object.values(response.rewards).forEach(arr => totalRecords += arr.length);
        Object.values(response.travelbuddy).forEach(arr => totalRecords += arr.length);
        
        const responseData = {
            success: true,
            message: "All data fetched successfully",
            filter_period: all ? 'All Time' : `${getMonthName(month)} ${year}`,
            month: all ? null : month,
            year: all ? null : year,
            total_records: totalRecords,
            data: response
        };
        
        // Store in cache
        await setToCache(cacheKey, responseData);
        
        res.json({ ...responseData, cached: false });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: "Error fetching all data",
            error: error.message
        });
    }
});

// Health check endpoint
app.get('/api/health', async (req, res) => {
    res.json({
        success: true,
        message: "Server is running",
        timestamp: new Date().toISOString(),
        redis: {
            connected: redisClient.isOpen,
            url: REDIS_URL,
            database: REDIS_DB,
            cache_expiry_days: 60
        },
        excel_files: EXCEL_FILES
    });
});

// Cache management endpoint - clear cache
app.delete('/api/cache', async (req, res) => {
    try {
        const { pattern } = req.query;
        const searchPattern = pattern ? `dummy-apis:${pattern}*` : 'dummy-apis:*';
        
        await clearCacheByPattern(searchPattern);
        
        res.json({
            success: true,
            message: `Cache cleared for pattern: ${searchPattern}`,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: "Error clearing cache",
            error: error.message
        });
    }
});

// Cache warm-up endpoint - pre-load all data into cache
app.post('/api/cache/warmup', async (req, res) => {
    try {
        if (!redisClient.isOpen) {
            return res.status(503).json({
                success: false,
                message: "Redis not connected. Cannot warm up cache.",
                connected: false
            });
        }

        const startTime = Date.now();
        const results = {
            remittance: { success: false, records: 0 },
            transactions: { success: false, records: 0 },
            rewards: { success: false, records: 0, sheets: {} },
            travelbuddy: { success: false, records: 0, sheets: {} }
        };

        // 1. Cache Remittance data (all data)
        try {
            const remittanceData = await readExcelSheet(EXCEL_FILES.remittance);
            const remittanceCacheKey = generateCacheKey('remittance', 0, 0, 'default', { all: 'true' });
            const remittanceStats = calculateStats(remittanceData, ['total_amount_in_BHD', 'amount']);
            const remittanceResponse = {
                success: true,
                message: "Remittance history fetched successfully",
                filter_period: 'All Time',
                month: null,
                year: null,
                total_records: remittanceData.length,
                summary: remittanceStats,
                data: remittanceData
            };
            await setToCache(remittanceCacheKey, remittanceResponse);
            results.remittance = { success: true, records: remittanceData.length };
        } catch (err) {
            results.remittance = { success: false, error: err.message };
        }

        // 2. Cache Transactions data (all data)
        try {
            const transactionsData = await readExcelSheet(EXCEL_FILES.transactions);
            const transactionsCacheKey = generateCacheKey('transactions', 0, 0, 'default', { all: 'true' });
            const transactionsStats = calculateStats(transactionsData, ['transaction_amount', 'amount', 'Amount']);
            const transactionsResponse = {
                success: true,
                message: "Transaction history fetched successfully",
                filter_period: 'All Time',
                month: null,
                year: null,
                total_records: transactionsData.length,
                summary: transactionsStats,
                data: transactionsData
            };
            await setToCache(transactionsCacheKey, transactionsResponse);
            results.transactions = { success: true, records: transactionsData.length };
        } catch (err) {
            results.transactions = { success: false, error: err.message };
        }

        // 3. Cache Rewards data (all sheets, all data)
        try {
            const rewardsSheetNames = await getSheetNames(EXCEL_FILES.rewards);
            let totalRewardsRecords = 0;
            const rewardsResponse = {};
            const sheetSummaries = {};

            for (const sheetName of rewardsSheetNames) {
                const sheetData = await readExcelSheet(EXCEL_FILES.rewards, sheetName);
                const key = sheetName.toLowerCase().replace(/\s+/g, '_');
                rewardsResponse[key] = sheetData;
                totalRewardsRecords += sheetData.length;
                
                const amountField = key === 'flyy_points' ? 'Points' : ['BHD_Amount', 'Amount', 'Txn_Amt', 'amount'];
                sheetSummaries[key] = calculateStats(sheetData, amountField);
                results.rewards.sheets[key] = sheetData.length;
            }

            const rewardsCacheKey = generateCacheKey('rewards', 0, 0, 'all', { all: 'true' });
            const fullRewardsResponse = {
                success: true,
                message: "Rewards history fetched successfully",
                filter_period: 'All Time',
                total_records: totalRewardsRecords,
                sheet_summaries: sheetSummaries,
                available_sheets: rewardsSheetNames,
                data: rewardsResponse
            };
            await setToCache(rewardsCacheKey, fullRewardsResponse);
            results.rewards.success = true;
            results.rewards.records = totalRewardsRecords;
        } catch (err) {
            results.rewards = { success: false, error: err.message };
        }

        // 4. Cache TravelBuddy data (all sheets, all data)
        try {
            const travelbuddySheetNames = await getSheetNames(EXCEL_FILES.travelbuddy);
            let totalTravelbuddyRecords = 0;
            const travelbuddyResponse = {};
            const sheetSummaries = {};

            for (const sheetName of travelbuddySheetNames) {
                const sheetData = await readExcelSheet(EXCEL_FILES.travelbuddy, sheetName);
                const key = sheetName.toLowerCase().replace(/\s+/g, '_');
                travelbuddyResponse[key] = sheetData;
                totalTravelbuddyRecords += sheetData.length;
                sheetSummaries[key] = calculateStats(sheetData, ['Amount', 'amount', 'Transaction_Amount']);
                results.travelbuddy.sheets[key] = sheetData.length;
            }

            const travelbuddyCacheKey = generateCacheKey('travelbuddy', 0, 0, 'all', { all: 'true' });
            const fullTravelbuddyResponse = {
                success: true,
                message: "TravelBuddy history fetched successfully",
                filter_period: 'All Time',
                total_records: totalTravelbuddyRecords,
                sheet_summaries: sheetSummaries,
                available_sheets: travelbuddySheetNames,
                data: travelbuddyResponse
            };
            await setToCache(travelbuddyCacheKey, fullTravelbuddyResponse);
            results.travelbuddy.success = true;
            results.travelbuddy.records = totalTravelbuddyRecords;
        } catch (err) {
            results.travelbuddy = { success: false, error: err.message };
        }

        const endTime = Date.now();
        const totalRecords = results.remittance.records + results.transactions.records + 
                            results.rewards.records + results.travelbuddy.records;

        res.json({
            success: true,
            message: "Cache warm-up completed",
            duration_ms: endTime - startTime,
            total_records_cached: totalRecords,
            cache_expiry: "2 months (60 days)",
            results: results,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: "Error during cache warm-up",
            error: error.message
        });
    }
});

// Cache info endpoint - get cache stats
app.get('/api/cache/info', async (req, res) => {
    try {
        if (!redisClient.isOpen) {
            return res.json({
                success: false,
                message: "Redis not connected",
                connected: false
            });
        }
        
        const keys = await redisClient.keys('dummy-apis:*');
        
        res.json({
            success: true,
            connected: true,
            total_cached_keys: keys.length,
            cache_expiry_days: 60,
            keys: keys.slice(0, 50) // Return first 50 keys
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: "Error getting cache info",
            error: error.message
        });
    }
});

// Get sheet info endpoint
app.get('/api/sheets', async (req, res) => {
    try {
        const sheetsInfo = {};
        
        for (const [key, filePath] of Object.entries(EXCEL_FILES)) {
            try {
                const sheets = await getSheetNames(filePath);
                sheetsInfo[key] = {
                    file: filePath,
                    sheets: sheets
                };
            } catch (err) {
                sheetsInfo[key] = {
                    file: filePath,
                    error: err.message
                };
            }
        }
        
        res.json({
            success: true,
            message: "Sheet information fetched successfully",
            data: sheetsInfo
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: "Error fetching sheet information",
            error: error.message
        });
    }
});

// Start server
app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
    console.log('\n🔴 REDIS CACHE:');
    console.log(`  URL: ${REDIS_URL}`);
    console.log(`  Database: ${REDIS_DB}`);
    console.log(`  Cache Expiry: 60 days (2 months)`);
    console.log('\n📊 DATA APIs (with Redis caching):');
    console.log('  GET /api/remittance        - Get remittance history');
    console.log('  GET /api/transactions      - Get transaction history');
    console.log('  GET /api/rewards           - Get rewards history');
    console.log('  GET /api/travelbuddy       - Get TravelBuddy history');
    console.log('  GET /api/all               - Get all data');
    console.log('  GET /api/sheets            - Get sheet info');
    console.log('  GET /api/health            - Health check');
    console.log('\n🗄️ CACHE APIs:');
    console.log('  GET    /api/cache/info     - Get cache statistics');
    console.log('  POST   /api/cache/warmup   - Pre-load all data into cache');
    console.log('  DELETE /api/cache          - Clear cache (optional ?pattern=)');
    console.log('\n📈 ANALYTICS APIs:');
    console.log('  GET /api/analytics/remittance/summary    - Remittance summary with date filter');
    console.log('  GET /api/analytics/transactions/summary  - Transaction summary with date filter');
    console.log('  GET /api/analytics/rewards/summary       - Rewards summary');
    console.log('  GET /api/analytics/travelbuddy/summary   - TravelBuddy summary');
    console.log('  GET /api/analytics/dashboard             - Complete dashboard');
    console.log('  GET /api/analytics/monthly               - Monthly breakdown');
    console.log('  GET /api/analytics/by-type               - Group by transaction type');
    console.log('  GET /api/analytics/by-country            - Group by country');
    console.log('  GET /api/analytics/by-category           - Group by MCC category');
    console.log('  GET /api/analytics/flyy-points           - Flyy points analytics');
    console.log('  GET /api/analytics/card-usage            - Card usage analytics');
    console.log('\nExcel files being used:');
    Object.entries(EXCEL_FILES).forEach(([key, path]) => {
        console.log(`  ${key}: ${path}`);
    });
});

// ============================================
// ANALYTICS API ENDPOINTS
// ============================================

// 1. Remittance Summary/Analytics
app.get('/api/analytics/remittance/summary', async (req, res) => {
    try {
        const { start_date, end_date, cpr, paymentmode } = req.query;
        
        let data = await readExcelSheet(EXCEL_FILES.remittance);
        
        // Apply date filter
        if (start_date || end_date) {
            data = data.filter(item => isDateInRange(item.timestamp_created, start_date, end_date));
        }
        
        // Apply other filters
        if (cpr) data = data.filter(item => item.cpr == cpr);
        if (paymentmode) data = data.filter(item => 
            item.paymentmode && item.paymentmode.toLowerCase().includes(paymentmode.toLowerCase())
        );
        
        // Calculate summary
        const successfulTxns = data.filter(item => item.status === true);
        const failedTxns = data.filter(item => item.status === false);
        
        const totalAmount = data.reduce((sum, item) => sum + (parseFloat(item['total_amount_in_BHD']) || 0), 0);
        const successAmount = successfulTxns.reduce((sum, item) => sum + (parseFloat(item['total_amount_in_BHD']) || 0), 0);
        const failedAmount = failedTxns.reduce((sum, item) => sum + (parseFloat(item['total_amount_in_BHD']) || 0), 0);
        const totalFees = data.reduce((sum, item) => sum + (parseFloat(item.fee) || 0), 0);
        const totalTax = data.reduce((sum, item) => sum + (parseFloat(item.tax) || 0), 0);
        
        // Group by payment mode
        const byPaymentMode = {};
        data.forEach(item => {
            const mode = item.paymentmode || 'Unknown';
            if (!byPaymentMode[mode]) {
                byPaymentMode[mode] = { count: 0, total_amount: 0, successful: 0, failed: 0 };
            }
            byPaymentMode[mode].count++;
            byPaymentMode[mode].total_amount += parseFloat(item['total_amount_in_BHD']) || 0;
            if (item.status === true) byPaymentMode[mode].successful++;
            else byPaymentMode[mode].failed++;
        });
        
        // Group by payment type
        const byPaymentType = {};
        data.forEach(item => {
            const type = item.paymenttype || 'Unknown';
            if (!byPaymentType[type]) {
                byPaymentType[type] = { count: 0, total_amount: 0 };
            }
            byPaymentType[type].count++;
            byPaymentType[type].total_amount += parseFloat(item['total_amount_in_BHD']) || 0;
        });
        
        res.json({
            success: true,
            message: "Remittance analytics fetched successfully",
            filters_applied: { start_date, end_date, cpr, paymentmode },
            summary: {
                total_transactions: data.length,
                successful_transactions: successfulTxns.length,
                failed_transactions: failedTxns.length,
                success_rate: data.length > 0 ? ((successfulTxns.length / data.length) * 100).toFixed(2) + '%' : '0%',
                total_amount_bhd: parseFloat(totalAmount.toFixed(3)),
                successful_amount_bhd: parseFloat(successAmount.toFixed(3)),
                failed_amount_bhd: parseFloat(failedAmount.toFixed(3)),
                total_fees_bhd: parseFloat(totalFees.toFixed(3)),
                total_tax_bhd: parseFloat(totalTax.toFixed(3)),
                average_transaction_bhd: data.length > 0 ? parseFloat((totalAmount / data.length).toFixed(3)) : 0
            },
            by_payment_mode: byPaymentMode,
            by_payment_type: byPaymentType
        });
    } catch (error) {
        res.status(500).json({ success: false, message: "Error fetching remittance analytics", error: error.message });
    }
});

// 2. Transactions Summary/Analytics
app.get('/api/analytics/transactions/summary', async (req, res) => {
    try {
        const { start_date, end_date, sender_cr, transaction_type, credit_debit } = req.query;
        
        let data = await readExcelSheet(EXCEL_FILES.transactions);
        
        // Apply date filter
        if (start_date || end_date) {
            data = data.filter(item => isDateInRange(item.transaction_date_time || item.created_date, start_date, end_date));
        }
        
        // Apply other filters
        if (sender_cr) data = data.filter(item => item.sender_cr == sender_cr);
        if (transaction_type) data = data.filter(item => 
            item.transaction_type && item.transaction_type.toLowerCase().includes(transaction_type.toLowerCase())
        );
        if (credit_debit) data = data.filter(item => 
            item.credit_debit && item.credit_debit.toLowerCase() === credit_debit.toLowerCase()
        );
        
        // Calculate summary
        const credits = data.filter(item => item.credit_debit === 'Credit');
        const debits = data.filter(item => item.credit_debit === 'Debit');
        
        const totalCredits = credits.reduce((sum, item) => sum + Math.abs(parseFloat(item['Transacted_Amount_in_BHD']) || 0), 0);
        const totalDebits = debits.reduce((sum, item) => sum + Math.abs(parseFloat(item['Transacted_Amount_in_BHD']) || 0), 0);
        const netAmount = totalCredits - totalDebits;
        
        // Group by transaction type
        const byTransactionType = {};
        data.forEach(item => {
            const type = item.transaction_type || 'Unknown';
            if (!byTransactionType[type]) {
                byTransactionType[type] = { count: 0, total_amount_bhd: 0, credits: 0, debits: 0 };
            }
            byTransactionType[type].count++;
            byTransactionType[type].total_amount_bhd += Math.abs(parseFloat(item['Transacted_Amount_in_BHD']) || 0);
            if (item.credit_debit === 'Credit') byTransactionType[type].credits++;
            else byTransactionType[type].debits++;
        });
        
        // Group by BFC type
        const byBfcType = {};
        data.forEach(item => {
            const type = item.bfc_type || 'Unknown';
            if (!byBfcType[type]) {
                byBfcType[type] = { count: 0, total_amount_bhd: 0 };
            }
            byBfcType[type].count++;
            byBfcType[type].total_amount_bhd += Math.abs(parseFloat(item['Transacted_Amount_in_BHD']) || 0);
        });
        
        // Get latest balance
        const latestBalance = data.length > 0 ? data[0]['available_balance_in_BHD'] : 0;
        
        res.json({
            success: true,
            message: "Transaction analytics fetched successfully",
            filters_applied: { start_date, end_date, sender_cr, transaction_type, credit_debit },
            summary: {
                total_transactions: data.length,
                credit_transactions: credits.length,
                debit_transactions: debits.length,
                total_credits_bhd: parseFloat(totalCredits.toFixed(3)),
                total_debits_bhd: parseFloat(totalDebits.toFixed(3)),
                net_amount_bhd: parseFloat(netAmount.toFixed(3)),
                latest_balance_bhd: latestBalance,
                average_transaction_bhd: data.length > 0 ? parseFloat(((totalCredits + totalDebits) / data.length).toFixed(3)) : 0
            },
            by_transaction_type: byTransactionType,
            by_bfc_type: byBfcType
        });
    } catch (error) {
        res.status(500).json({ success: false, message: "Error fetching transaction analytics", error: error.message });
    }
});

// 3. Rewards Summary/Analytics
app.get('/api/analytics/rewards/summary', async (req, res) => {
    try {
        const { start_date, end_date, customerId } = req.query;
        
        // Read all reward sheets
        const transactions = await readExcelSheet(EXCEL_FILES.rewards, 'Transactions');
        const loads = await readExcelSheet(EXCEL_FILES.rewards, 'Load');
        const flyyPoints = await readExcelSheet(EXCEL_FILES.rewards, 'Flyy points');
        
        // Filter by date and customerId
        let filteredTxns = transactions;
        let filteredLoads = loads;
        let filteredPoints = flyyPoints;
        
        if (customerId) {
            filteredTxns = filteredTxns.filter(item => item.customerId == customerId);
            filteredLoads = filteredLoads.filter(item => item.customerId == customerId);
        }
        
        if (start_date || end_date) {
            filteredTxns = filteredTxns.filter(item => isDateInRange(item.Txn_Date, start_date, end_date));
            filteredLoads = filteredLoads.filter(item => isDateInRange(item.Txn_Date, start_date, end_date));
            filteredPoints = filteredPoints.filter(item => isDateInRange(item.Created_At, start_date, end_date));
        }
        
        // Transaction analytics
        const totalSpent = filteredTxns.filter(item => item.crdr === 'DR')
            .reduce((sum, item) => sum + (parseFloat(item.BHD_Amount) || 0), 0);
        const totalMarkup = filteredTxns.reduce((sum, item) => sum + (parseFloat(item.Markup) || 0), 0);
        
        // Load analytics
        const totalLoaded = filteredLoads.reduce((sum, item) => sum + (parseFloat(item.BHD_Amount) || 0), 0);
        const totalLoadedUSD = filteredLoads.reduce((sum, item) => sum + (parseFloat(item.USD_Amount) || 0), 0);
        
        // Flyy points analytics
        const pointsEarned = filteredPoints.filter(item => item.Type === 'credit')
            .reduce((sum, item) => sum + (parseInt(item.Points) || 0), 0);
        const pointsRedeemed = filteredPoints.filter(item => item.Type === 'debit')
            .reduce((sum, item) => sum + (parseInt(item.Points) || 0), 0);
        
        // By country
        const byCountry = {};
        filteredTxns.forEach(item => {
            const country = item.Country || 'Unknown';
            if (!byCountry[country]) {
                byCountry[country] = { count: 0, total_bhd: 0 };
            }
            byCountry[country].count++;
            byCountry[country].total_bhd += parseFloat(item.BHD_Amount) || 0;
        });
        
        // By MCC category
        const byCategory = {};
        filteredTxns.forEach(item => {
            const cat = item.MCC_Category || 'Unknown';
            if (!byCategory[cat]) {
                byCategory[cat] = { count: 0, total_bhd: 0 };
            }
            byCategory[cat].count++;
            byCategory[cat].total_bhd += parseFloat(item.BHD_Amount) || 0;
        });
        
        res.json({
            success: true,
            message: "Rewards analytics fetched successfully",
            filters_applied: { start_date, end_date, customerId },
            transactions_summary: {
                total_transactions: filteredTxns.length,
                total_spent_bhd: parseFloat(totalSpent.toFixed(3)),
                total_markup_bhd: parseFloat(totalMarkup.toFixed(3)),
                domestic_count: filteredTxns.filter(i => i['Domestic_International'] === 'Domestic').length,
                international_count: filteredTxns.filter(i => i['Domestic_International'] === 'International').length,
                pos_count: filteredTxns.filter(i => i.transactionType_dsc === 'POS').length,
                ecom_count: filteredTxns.filter(i => i.transactionType_dsc === 'ECOM').length
            },
            load_summary: {
                total_loads: filteredLoads.length,
                total_loaded_bhd: parseFloat(totalLoaded.toFixed(3)),
                total_loaded_usd: parseFloat(totalLoadedUSD.toFixed(2)),
                average_load_bhd: filteredLoads.length > 0 ? parseFloat((totalLoaded / filteredLoads.length).toFixed(3)) : 0
            },
            flyy_points_summary: {
                total_point_transactions: filteredPoints.length,
                total_points_earned: pointsEarned,
                total_points_redeemed: pointsRedeemed,
                net_points: pointsEarned - pointsRedeemed
            },
            by_country: byCountry,
            by_category: byCategory
        });
    } catch (error) {
        res.status(500).json({ success: false, message: "Error fetching rewards analytics", error: error.message });
    }
});

// 4. TravelBuddy Summary/Analytics
app.get('/api/analytics/travelbuddy/summary', async (req, res) => {
    try {
        const { start_date, end_date, customerId, country } = req.query;
        
        const transactions = await readExcelSheet(EXCEL_FILES.travelbuddy, 'Transactions');
        const loads = await readExcelSheet(EXCEL_FILES.travelbuddy, 'Load');
        
        let filteredTxns = transactions;
        let filteredLoads = loads;
        
        if (customerId) {
            filteredTxns = filteredTxns.filter(item => item.customerId == customerId);
            filteredLoads = filteredLoads.filter(item => item.customerId == customerId);
        }
        
        if (country) {
            filteredTxns = filteredTxns.filter(item => 
                item.Country && item.Country.toLowerCase().includes(country.toLowerCase())
            );
        }
        
        if (start_date || end_date) {
            filteredTxns = filteredTxns.filter(item => isDateInRange(item.Txn_Date, start_date, end_date));
            filteredLoads = filteredLoads.filter(item => isDateInRange(item.Txn_Date, start_date, end_date));
        }
        
        // Transaction analytics
        const totalSpent = filteredTxns.filter(item => item.crdr === 'DR')
            .reduce((sum, item) => sum + (parseFloat(item.BHD_Amount) || 0), 0);
        const totalMarkup = filteredTxns.reduce((sum, item) => sum + (parseFloat(item.Markup) || 0), 0);
        
        // Load analytics
        const totalLoaded = filteredLoads.reduce((sum, item) => sum + (parseFloat(item.BHD_Amount) || 0), 0);
        const totalLoadedUSD = filteredLoads.reduce((sum, item) => sum + (parseFloat(item.USD_Amount) || 0), 0);
        
        // Get latest wallet balance
        const latestBalance = filteredLoads.length > 0 ? filteredLoads[filteredLoads.length - 1].To_Wallet_Balance : 0;
        
        // By country
        const byCountry = {};
        filteredTxns.forEach(item => {
            const c = item.Country || 'Unknown';
            if (!byCountry[c]) {
                byCountry[c] = { count: 0, total_bhd: 0, total_markup: 0 };
            }
            byCountry[c].count++;
            byCountry[c].total_bhd += parseFloat(item.BHD_Amount) || 0;
            byCountry[c].total_markup += parseFloat(item.Markup) || 0;
        });
        
        res.json({
            success: true,
            message: "TravelBuddy analytics fetched successfully",
            filters_applied: { start_date, end_date, customerId, country },
            transactions_summary: {
                total_transactions: filteredTxns.length,
                total_spent_bhd: parseFloat(totalSpent.toFixed(3)),
                total_markup_bhd: parseFloat(totalMarkup.toFixed(3)),
                domestic_count: filteredTxns.filter(i => i['Domestic_International'] === 'Domestic').length,
                international_count: filteredTxns.filter(i => i['Domestic_International'] === 'International').length,
                average_transaction_bhd: filteredTxns.length > 0 ? parseFloat((totalSpent / filteredTxns.length).toFixed(3)) : 0
            },
            load_summary: {
                total_loads: filteredLoads.length,
                total_loaded_bhd: parseFloat(totalLoaded.toFixed(3)),
                total_loaded_usd: parseFloat(totalLoadedUSD.toFixed(2)),
                current_wallet_balance: latestBalance
            },
            by_country: byCountry
        });
    } catch (error) {
        res.status(500).json({ success: false, message: "Error fetching TravelBuddy analytics", error: error.message });
    }
});

// 5. Complete Dashboard
app.get('/api/analytics/dashboard', async (req, res) => {
    try {
        const { start_date, end_date, cpr, customerId } = req.query;
        const customerFilter = cpr || customerId || 851276393;
        
        // Remittance
        let remittance = await readExcelSheet(EXCEL_FILES.remittance);
        if (start_date || end_date) {
            remittance = remittance.filter(item => isDateInRange(item.timestamp_created, start_date, end_date));
        }
        remittance = remittance.filter(item => item.cpr == customerFilter);
        
        // Transactions
        let transactions = await readExcelSheet(EXCEL_FILES.transactions);
        if (start_date || end_date) {
            transactions = transactions.filter(item => isDateInRange(item.transaction_date_time, start_date, end_date));
        }
        transactions = transactions.filter(item => item.sender_cr == customerFilter);
        
        // Rewards
        const rewardsTxns = (await readExcelSheet(EXCEL_FILES.rewards, 'Transactions'))
            .filter(item => item.customerId == customerFilter);
        const rewardsLoads = (await readExcelSheet(EXCEL_FILES.rewards, 'Load'))
            .filter(item => item.customerId == customerFilter);
        const flyyPoints = await readExcelSheet(EXCEL_FILES.rewards, 'Flyy points');
        
        // TravelBuddy
        const tbTxns = (await readExcelSheet(EXCEL_FILES.travelbuddy, 'Transactions'))
            .filter(item => item.customerId == customerFilter);
        const tbLoads = (await readExcelSheet(EXCEL_FILES.travelbuddy, 'Load'))
            .filter(item => item.customerId == customerFilter);
        
        // Calculate totals
        const remittanceTotal = remittance.reduce((sum, i) => sum + (parseFloat(i['total_amount_in_BHD']) || 0), 0);
        const txnCredits = transactions.filter(i => i.credit_debit === 'Credit')
            .reduce((sum, i) => sum + Math.abs(parseFloat(i['Transacted_Amount_in_BHD']) || 0), 0);
        const txnDebits = transactions.filter(i => i.credit_debit === 'Debit')
            .reduce((sum, i) => sum + Math.abs(parseFloat(i['Transacted_Amount_in_BHD']) || 0), 0);
        const rewardsSpent = rewardsTxns.reduce((sum, i) => sum + (parseFloat(i.BHD_Amount) || 0), 0);
        const rewardsLoaded = rewardsLoads.reduce((sum, i) => sum + (parseFloat(i.BHD_Amount) || 0), 0);
        const tbSpent = tbTxns.reduce((sum, i) => sum + (parseFloat(i.BHD_Amount) || 0), 0);
        const tbLoaded = tbLoads.reduce((sum, i) => sum + (parseFloat(i.BHD_Amount) || 0), 0);
        
        const pointsEarned = flyyPoints.filter(i => i.Type === 'credit')
            .reduce((sum, i) => sum + (parseInt(i.Points) || 0), 0);
        const pointsRedeemed = flyyPoints.filter(i => i.Type === 'debit')
            .reduce((sum, i) => sum + (parseInt(i.Points) || 0), 0);
        
        res.json({
            success: true,
            message: "Dashboard data fetched successfully",
            filters_applied: { start_date, end_date, customer_id: customerFilter },
            overview: {
                total_remittance_bhd: parseFloat(remittanceTotal.toFixed(3)),
                wallet_credits_bhd: parseFloat(txnCredits.toFixed(3)),
                wallet_debits_bhd: parseFloat(txnDebits.toFixed(3)),
                wallet_net_bhd: parseFloat((txnCredits - txnDebits).toFixed(3)),
                rewards_card_spent_bhd: parseFloat(rewardsSpent.toFixed(3)),
                rewards_card_loaded_bhd: parseFloat(rewardsLoaded.toFixed(3)),
                travelbuddy_spent_bhd: parseFloat(tbSpent.toFixed(3)),
                travelbuddy_loaded_bhd: parseFloat(tbLoaded.toFixed(3)),
                flyy_points_earned: pointsEarned,
                flyy_points_redeemed: pointsRedeemed,
                flyy_points_balance: pointsEarned - pointsRedeemed
            },
            transaction_counts: {
                remittance: remittance.length,
                wallet_transactions: transactions.length,
                rewards_transactions: rewardsTxns.length,
                rewards_loads: rewardsLoads.length,
                travelbuddy_transactions: tbTxns.length,
                travelbuddy_loads: tbLoads.length,
                flyy_point_transactions: flyyPoints.length
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, message: "Error fetching dashboard", error: error.message });
    }
});

// 6. Monthly Breakdown
app.get('/api/analytics/monthly', async (req, res) => {
    try {
        const { year, source } = req.query;
        const filterYear = year || new Date().getFullYear();
        
        let data = [];
        let dateField = '';
        let amountField = '';
        
        switch (source) {
            case 'remittance':
                data = await readExcelSheet(EXCEL_FILES.remittance);
                dateField = 'timestamp_created';
                amountField = 'total_amount_in_BHD';
                break;
            case 'transactions':
                data = await readExcelSheet(EXCEL_FILES.transactions);
                dateField = 'transaction_date_time';
                amountField = 'Transacted_Amount_in_BHD';
                break;
            case 'rewards':
                data = await readExcelSheet(EXCEL_FILES.rewards, 'Transactions');
                dateField = 'Txn_Date';
                amountField = 'BHD_Amount';
                break;
            case 'travelbuddy':
                data = await readExcelSheet(EXCEL_FILES.travelbuddy, 'Transactions');
                dateField = 'Txn_Date';
                amountField = 'BHD_Amount';
                break;
            default:
                // All sources combined
                const remit = await readExcelSheet(EXCEL_FILES.remittance);
                const txns = await readExcelSheet(EXCEL_FILES.transactions);
                return res.json({
                    success: true,
                    message: "Specify source parameter: remittance, transactions, rewards, or travelbuddy"
                });
        }
        
        const monthly = {};
        const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        months.forEach((m, i) => {
            monthly[m] = { count: 0, total_bhd: 0 };
        });
        
        data.forEach(item => {
            const date = parseDate(item[dateField]);
            if (date && date.getFullYear() == filterYear) {
                const month = months[date.getMonth()];
                monthly[month].count++;
                monthly[month].total_bhd += Math.abs(parseFloat(item[amountField]) || 0);
            }
        });
        
        // Round amounts
        Object.keys(monthly).forEach(m => {
            monthly[m].total_bhd = parseFloat(monthly[m].total_bhd.toFixed(3));
        });
        
        res.json({
            success: true,
            message: "Monthly breakdown fetched successfully",
            year: filterYear,
            source: source,
            monthly_data: monthly
        });
    } catch (error) {
        res.status(500).json({ success: false, message: "Error fetching monthly data", error: error.message });
    }
});

// 7. Group by Transaction Type
app.get('/api/analytics/by-type', async (req, res) => {
    try {
        const { start_date, end_date } = req.query;
        
        // Wallet transactions
        let walletTxns = await readExcelSheet(EXCEL_FILES.transactions);
        if (start_date || end_date) {
            walletTxns = walletTxns.filter(item => isDateInRange(item.transaction_date_time, start_date, end_date));
        }
        
        const byType = {};
        walletTxns.forEach(item => {
            const type = item.transaction_type || 'Unknown';
            if (!byType[type]) {
                byType[type] = { 
                    count: 0, 
                    total_bhd: 0, 
                    credits: 0, 
                    debits: 0,
                    credit_amount: 0,
                    debit_amount: 0
                };
            }
            byType[type].count++;
            const amount = Math.abs(parseFloat(item['Transacted_Amount_in_BHD']) || 0);
            byType[type].total_bhd += amount;
            if (item.credit_debit === 'Credit') {
                byType[type].credits++;
                byType[type].credit_amount += amount;
            } else {
                byType[type].debits++;
                byType[type].debit_amount += amount;
            }
        });
        
        // Round amounts
        Object.keys(byType).forEach(t => {
            byType[t].total_bhd = parseFloat(byType[t].total_bhd.toFixed(3));
            byType[t].credit_amount = parseFloat(byType[t].credit_amount.toFixed(3));
            byType[t].debit_amount = parseFloat(byType[t].debit_amount.toFixed(3));
        });
        
        res.json({
            success: true,
            message: "Transaction types breakdown fetched successfully",
            filters_applied: { start_date, end_date },
            by_transaction_type: byType
        });
    } catch (error) {
        res.status(500).json({ success: false, message: "Error fetching by type", error: error.message });
    }
});

// 8. Group by Country
app.get('/api/analytics/by-country', async (req, res) => {
    try {
        const { start_date, end_date, source } = req.query;
        
        let data = [];
        if (source === 'travelbuddy') {
            data = await readExcelSheet(EXCEL_FILES.travelbuddy, 'Transactions');
        } else {
            data = await readExcelSheet(EXCEL_FILES.rewards, 'Transactions');
        }
        
        if (start_date || end_date) {
            data = data.filter(item => isDateInRange(item.Txn_Date, start_date, end_date));
        }
        
        const byCountry = {};
        data.forEach(item => {
            const country = item.Country || 'Unknown';
            if (!byCountry[country]) {
                byCountry[country] = { 
                    count: 0, 
                    total_bhd: 0, 
                    total_markup: 0,
                    pos_count: 0,
                    ecom_count: 0
                };
            }
            byCountry[country].count++;
            byCountry[country].total_bhd += parseFloat(item.BHD_Amount) || 0;
            byCountry[country].total_markup += parseFloat(item.Markup) || 0;
            if (item.transactionType_dsc === 'POS') byCountry[country].pos_count++;
            if (item.transactionType_dsc === 'ECOM') byCountry[country].ecom_count++;
        });
        
        // Round and sort by count
        const sorted = Object.entries(byCountry)
            .map(([country, stats]) => ({
                country,
                count: stats.count,
                total_bhd: parseFloat(stats.total_bhd.toFixed(3)),
                total_markup_bhd: parseFloat(stats.total_markup.toFixed(3)),
                pos_count: stats.pos_count,
                ecom_count: stats.ecom_count
            }))
            .sort((a, b) => b.count - a.count);
        
        res.json({
            success: true,
            message: "Country breakdown fetched successfully",
            filters_applied: { start_date, end_date, source: source || 'rewards' },
            total_countries: sorted.length,
            by_country: sorted
        });
    } catch (error) {
        res.status(500).json({ success: false, message: "Error fetching by country", error: error.message });
    }
});

// 9. Group by MCC Category
app.get('/api/analytics/by-category', async (req, res) => {
    try {
        const { start_date, end_date, source } = req.query;
        
        let data = [];
        if (source === 'travelbuddy') {
            data = await readExcelSheet(EXCEL_FILES.travelbuddy, 'Transactions');
        } else {
            data = await readExcelSheet(EXCEL_FILES.rewards, 'Transactions');
        }
        
        if (start_date || end_date) {
            data = data.filter(item => isDateInRange(item.Txn_Date, start_date, end_date));
        }
        
        const byCategory = {};
        data.forEach(item => {
            const category = item.MCC_Category || 'Unknown';
            if (!byCategory[category]) {
                byCategory[category] = { 
                    count: 0, 
                    total_bhd: 0, 
                    average_bhd: 0,
                    mcc_codes: new Set()
                };
            }
            byCategory[category].count++;
            byCategory[category].total_bhd += parseFloat(item.BHD_Amount) || 0;
            if (item.mcc) byCategory[category].mcc_codes.add(item.mcc);
        });
        
        // Calculate averages and sort
        const sorted = Object.entries(byCategory)
            .map(([category, stats]) => ({
                category,
                count: stats.count,
                total_bhd: parseFloat(stats.total_bhd.toFixed(3)),
                average_bhd: parseFloat((stats.total_bhd / stats.count).toFixed(3)),
                mcc_codes: Array.from(stats.mcc_codes)
            }))
            .sort((a, b) => b.total_bhd - a.total_bhd);
        
        res.json({
            success: true,
            message: "Category breakdown fetched successfully",
            filters_applied: { start_date, end_date, source: source || 'rewards' },
            total_categories: sorted.length,
            by_category: sorted
        });
    } catch (error) {
        res.status(500).json({ success: false, message: "Error fetching by category", error: error.message });
    }
});

// 10. Flyy Points Analytics
app.get('/api/analytics/flyy-points', async (req, res) => {
    try {
        const { start_date, end_date, type } = req.query;
        
        let data = await readExcelSheet(EXCEL_FILES.rewards, 'Flyy points');
        
        if (start_date || end_date) {
            data = data.filter(item => isDateInRange(item.Created_At, start_date, end_date));
        }
        
        if (type) {
            data = data.filter(item => item.Type && item.Type.toLowerCase() === type.toLowerCase());
        }
        
        const credits = data.filter(i => i.Type === 'credit');
        const debits = data.filter(i => i.Type === 'debit');
        
        const totalEarned = credits.reduce((sum, i) => sum + (parseInt(i.Points) || 0), 0);
        const totalRedeemed = debits.reduce((sum, i) => sum + (parseInt(i.Points) || 0), 0);
        
        // Group by message/reason
        const byReason = {};
        data.forEach(item => {
            const reason = item.Message || 'Unknown';
            if (!byReason[reason]) {
                byReason[reason] = { count: 0, total_points: 0, type: item.Type };
            }
            byReason[reason].count++;
            byReason[reason].total_points += parseInt(item.Points) || 0;
        });
        
        res.json({
            success: true,
            message: "Flyy points analytics fetched successfully",
            filters_applied: { start_date, end_date, type },
            summary: {
                total_transactions: data.length,
                credit_transactions: credits.length,
                debit_transactions: debits.length,
                total_points_earned: totalEarned,
                total_points_redeemed: totalRedeemed,
                net_points: totalEarned - totalRedeemed,
                average_earn_per_transaction: credits.length > 0 ? Math.round(totalEarned / credits.length) : 0,
                average_redeem_per_transaction: debits.length > 0 ? Math.round(totalRedeemed / debits.length) : 0
            },
            by_reason: byReason
        });
    } catch (error) {
        res.status(500).json({ success: false, message: "Error fetching flyy points analytics", error: error.message });
    }
});

// 11. Card Usage Analytics (Rewards + TravelBuddy combined)
app.get('/api/analytics/card-usage', async (req, res) => {
    try {
        const { start_date, end_date, customerId } = req.query;
        
        // Rewards card
        let rewardsTxns = await readExcelSheet(EXCEL_FILES.rewards, 'Transactions');
        let rewardsLoads = await readExcelSheet(EXCEL_FILES.rewards, 'Load');
        
        // TravelBuddy card
        let tbTxns = await readExcelSheet(EXCEL_FILES.travelbuddy, 'Transactions');
        let tbLoads = await readExcelSheet(EXCEL_FILES.travelbuddy, 'Load');
        
        // Apply filters
        if (customerId) {
            rewardsTxns = rewardsTxns.filter(i => i.customerId == customerId);
            rewardsLoads = rewardsLoads.filter(i => i.customerId == customerId);
            tbTxns = tbTxns.filter(i => i.customerId == customerId);
            tbLoads = tbLoads.filter(i => i.customerId == customerId);
        }
        
        if (start_date || end_date) {
            rewardsTxns = rewardsTxns.filter(i => isDateInRange(i.Txn_Date, start_date, end_date));
            rewardsLoads = rewardsLoads.filter(i => isDateInRange(i.Txn_Date, start_date, end_date));
            tbTxns = tbTxns.filter(i => isDateInRange(i.Txn_Date, start_date, end_date));
            tbLoads = tbLoads.filter(i => isDateInRange(i.Txn_Date, start_date, end_date));
        }
        
        // Rewards card stats
        const rewardsSpent = rewardsTxns.reduce((sum, i) => sum + (parseFloat(i.BHD_Amount) || 0), 0);
        const rewardsLoaded = rewardsLoads.reduce((sum, i) => sum + (parseFloat(i.BHD_Amount) || 0), 0);
        const rewardsMarkup = rewardsTxns.reduce((sum, i) => sum + (parseFloat(i.Markup) || 0), 0);
        
        // TravelBuddy card stats
        const tbSpent = tbTxns.reduce((sum, i) => sum + (parseFloat(i.BHD_Amount) || 0), 0);
        const tbLoaded = tbLoads.reduce((sum, i) => sum + (parseFloat(i.BHD_Amount) || 0), 0);
        const tbMarkup = tbTxns.reduce((sum, i) => sum + (parseFloat(i.Markup) || 0), 0);
        
        // Get card numbers
        const rewardsCards = [...new Set(rewardsLoads.map(i => i.cardNumber).filter(Boolean))];
        const tbCards = [...new Set(tbLoads.map(i => i.cardNumber).filter(Boolean))];
        
        res.json({
            success: true,
            message: "Card usage analytics fetched successfully",
            filters_applied: { start_date, end_date, customerId },
            rewards_card: {
                card_numbers: rewardsCards,
                total_transactions: rewardsTxns.length,
                total_loads: rewardsLoads.length,
                total_spent_bhd: parseFloat(rewardsSpent.toFixed(3)),
                total_loaded_bhd: parseFloat(rewardsLoaded.toFixed(3)),
                total_markup_bhd: parseFloat(rewardsMarkup.toFixed(3)),
                balance_estimate: parseFloat((rewardsLoaded - rewardsSpent).toFixed(3)),
                domestic_txns: rewardsTxns.filter(i => i['Domestic_International'] === 'Domestic').length,
                international_txns: rewardsTxns.filter(i => i['Domestic_International'] === 'International').length
            },
            travelbuddy_card: {
                card_numbers: tbCards,
                total_transactions: tbTxns.length,
                total_loads: tbLoads.length,
                total_spent_bhd: parseFloat(tbSpent.toFixed(3)),
                total_loaded_bhd: parseFloat(tbLoaded.toFixed(3)),
                total_markup_bhd: parseFloat(tbMarkup.toFixed(3)),
                balance_estimate: parseFloat((tbLoaded - tbSpent).toFixed(3)),
                domestic_txns: tbTxns.filter(i => i['Domestic_International'] === 'Domestic').length,
                international_txns: tbTxns.filter(i => i['Domestic_International'] === 'International').length
            },
            combined: {
                total_transactions: rewardsTxns.length + tbTxns.length,
                total_loads: rewardsLoads.length + tbLoads.length,
                total_spent_bhd: parseFloat((rewardsSpent + tbSpent).toFixed(3)),
                total_loaded_bhd: parseFloat((rewardsLoaded + tbLoaded).toFixed(3)),
                total_markup_bhd: parseFloat((rewardsMarkup + tbMarkup).toFixed(3))
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, message: "Error fetching card usage analytics", error: error.message });
    }
});
