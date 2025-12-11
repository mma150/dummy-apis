const express = require('express');
const XlsxPopulate = require('xlsx-populate');
const path = require('path');
const redis = require('redis');
const xlsx = require('xlsx');
const swaggerUi = require('swagger-ui-express');
const swaggerJsdoc = require('swagger-jsdoc');

// Import route files
const initRemittanceRoutes = require('./routes/remittance');
const initTransactionsRoutes = require('./routes/transactions');
const initRewardsRoutes = require('./routes/rewards');
const initTravelBuddyRoutes = require('./routes/travelbuddy');

const app = express();
const port = process.env.PORT || 9191;

// Swagger Setup
const swaggerOptions = {
    definition: {
        openapi: '3.0.0',
        info: {
            title: 'AI Finance MCP API',
            version: '1.0.0',
            description: 'MCP Tools for AI Finance Voice Agent, backed by Redis and Excel.',
        },
        servers: [
            {
                url: `http://localhost:${port}`,
                description: 'Local Server',
            },
        ],
    },
    apis: ['./server.js'], // Files containing annotations
};

const swaggerDocs = swaggerJsdoc(swaggerOptions);
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerDocs));

app.use(express.json());

// Request logging middleware
app.use((req, res, next) => {
    const startTime = Date.now();
    const timestamp = new Date().toISOString();
    
    // Log request
    console.log(`\n📥 [${timestamp}] ${req.method} ${req.originalUrl}`);
    if (Object.keys(req.query).length > 0) {
        console.log(`   Query: ${JSON.stringify(req.query)}`);
    }
    if (req.body && Object.keys(req.body).length > 0) {
        console.log(`   Body: ${JSON.stringify(req.body)}`);
    }
    
    // Capture response
    const originalSend = res.send;
    res.send = function(data) {
        const duration = Date.now() - startTime;
        const statusEmoji = res.statusCode >= 400 ? '❌' : '✅';
        console.log(`${statusEmoji} [${timestamp}] ${req.method} ${req.originalUrl} - ${res.statusCode} (${duration}ms)`);
        return originalSend.call(this, data);
    };
    
    next();
});

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

// Auto cache warmup function
async function autoWarmupCache() {
    if (!redisClient.isOpen) {
        console.log('⚠️ Redis not connected, skipping auto-warmup');
        return;
    }

    console.log('🔥 Starting auto cache warmup...');
    const startTime = Date.now();

    try {
        // Check if cache already has data (avoid redundant warmup)
        const testKey = 'transactions:sheet1';
        const existing = await redisClient.get(testKey);
        if (existing) {
            console.log('✅ Cache already warm, skipping warmup');
            return;
        }

        // Warmup small files first (fast)
        const warmupPromises = [
            (async () => {
                const data = await readExcelSheet(EXCEL_FILES.remittance);
                await setToCache('remittance:sheet1', {
                    success: true,
                    message: "Remittance history fetched successfully",
                    filter_period: 'All Time',
                    total_records: data.length,
                    summary: calculateStats(data, ['total_amount_in_BHD', 'amount']),
                    data: data
                });
                return { type: 'remittance', records: data.length };
            })(),
            (async () => {
                const data = await readExcelSheet(EXCEL_FILES.transactions);
                await setToCache('transactions:sheet1', {
                    success: true,
                    message: "Transaction history fetched successfully",
                    filter_period: 'All Time',
                    total_records: data.length,
                    summary: calculateStats(data, ['transaction_amount', 'amount', 'Amount']),
                    data: data
                });
                return { type: 'transactions', records: data.length };
            })()
        ];

        const smallResults = await Promise.all(warmupPromises);
        
        // Now warmup large files by sheet (reduces memory pressure)
        const largeFilePromises = [
            // Rewards - cache each sheet separately
            (async () => {
                let totalRecords = 0;
                const sheetKeyMap = { 'Transactions': 'transactions', 'Load': 'load', 'Flyy points': 'flyypoints' };
                for (const sheetName of ['Transactions', 'Load', 'Flyy points']) {
                    const data = await readExcelSheet(EXCEL_FILES.rewards, sheetName);
                    const cacheKey = `rewardhistory:${sheetKeyMap[sheetName]}`;
                    await setToCache(cacheKey, {
                        success: true,
                        sheet: sheetName,
                        total_records: data.length,
                        data: data
                    });
                    totalRecords += data.length;
                }
                return { type: 'rewards', records: totalRecords };
            })(),
            // TravelBuddy - cache each sheet separately
            (async () => {
                let totalRecords = 0;
                const sheetKeyMap = { 'Transactions': 'transactions', 'Load': 'load' };
                for (const sheetName of ['Transactions', 'Load']) {
                    const data = await readExcelSheet(EXCEL_FILES.travelbuddy, sheetName);
                    const cacheKey = `travelbuddy:${sheetKeyMap[sheetName]}`;
                    await setToCache(cacheKey, {
                        success: true,
                        sheet: sheetName,
                        total_records: data.length,
                        data: data
                    });
                    totalRecords += data.length;
                }
                return { type: 'travelbuddy', records: totalRecords };
            })()
        ];

        const largeResults = await Promise.all(largeFilePromises);
        const results = [...smallResults, ...largeResults];
        const totalRecords = results.reduce((sum, r) => sum + r.records, 0);
        const duration = Date.now() - startTime;

        console.log(`✅ Auto cache warmup complete: ${totalRecords} records cached in ${duration}ms`);
        results.forEach(r => console.log(`   - ${r.type}: ${r.records} records`));
    } catch (err) {
        console.error('❌ Auto cache warmup failed:', err.message);
    }
}

// Connect to Redis
(async () => {
    try {
        await redisClient.connect();
        console.log(`Connected to Redis at ${REDIS_URL}, DB: ${REDIS_DB}`);
        
        // Auto warmup cache after successful connection
        // Use setTimeout to not block server startup
        setTimeout(autoWarmupCache, 1000);
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

// Sheet name to key mapping
const SHEET_KEY_MAP = {
    'Transactions': 'transactions',
    'Load': 'load',
    'Flyy points': 'flyypoints',
    'default': 'sheet1'
};

// Generate cache key based on file:sheet pattern
function generateCacheKey(fileType, sheetName = 'default') {
    const sheetKey = SHEET_KEY_MAP[sheetName] || sheetName.toLowerCase().replace(/\s+/g, '');
    return `${fileType}:${sheetKey}`;
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

// ============================================
// OPTIMIZED DATA LOADERS (per-sheet caching)
// ============================================

// In-memory cache for ultra-fast access (avoids Redis network latency)
const memoryCache = new Map();
const MEMORY_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

function getFromMemoryCache(key) {
    const cached = memoryCache.get(key);
    if (cached && cached.expiry > Date.now()) {
        return cached.data;
    }
    // Expired or not found
    if (cached) memoryCache.delete(key);
    return null;
}

function setToMemoryCache(key, data) {
    memoryCache.set(key, {
        data: data,
        expiry: Date.now() + MEMORY_CACHE_TTL
    });
}

// Helper to get single sheet data (memory -> Redis -> file)
async function getSheetData(fileType, sheetName, filePath) {
    const sheetKey = SHEET_KEY_MAP[sheetName] || sheetName.toLowerCase().replace(/\s+/g, '');
    const memKey = `mem:${fileType}:${sheetKey}`;
    const redisKey = `${fileType}:${sheetKey}`;
    
    // 1. Check memory cache first (fastest)
    const memCached = getFromMemoryCache(memKey);
    if (memCached) {
        return memCached;
    }
    
    // 2. Check Redis cache
    const redisCached = await getFromCache(redisKey);
    if (redisCached && redisCached.data) {
        // Store in memory for faster subsequent access
        setToMemoryCache(memKey, redisCached.data);
        return redisCached.data;
    }
    
    // 3. Load from file and cache in both layers
    const data = await readExcelSheet(filePath, sheetName);
    const dataWithSheet = data.map(row => ({ ...row, _sheet: sheetName }));
    
    // Cache in both Redis and memory
    setToMemoryCache(memKey, dataWithSheet);
    setToCache(redisKey, {
        success: true,
        sheet: sheetName,
        total_records: dataWithSheet.length,
        data: dataWithSheet
    });
    
    return dataWithSheet;
}

// Get rewards data - loads sheets in PARALLEL
async function getRewardsData(sheetName = null) {
    const sheets = sheetName ? [sheetName] : ['Transactions', 'Load', 'Flyy points'];
    
    // Load all sheets in parallel for better performance
    const sheetPromises = sheets.map(sheet => 
        getSheetData('rewards', sheet, EXCEL_FILES.rewards)
    );
    
    const results = await Promise.all(sheetPromises);
    return results.flat();
}

// Get travelbuddy data - loads sheets in PARALLEL
async function getTravelBuddyData(sheetName = null) {
    const sheets = sheetName ? [sheetName] : ['Transactions', 'Load'];
    
    // Load all sheets in parallel for better performance
    const sheetPromises = sheets.map(sheet => 
        getSheetData('travelbuddy', sheet, EXCEL_FILES.travelbuddy)
    );
    
    const results = await Promise.all(sheetPromises);
    return results.flat();
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

// Read all sheets from an Excel file
async function readAllExcelSheets(filePath) {
    try {
        console.log(`Reading all sheets from ${path.basename(filePath)}...`);
        const workbook = await XlsxPopulate.fromFileAsync(filePath, { password: EXCEL_PASSWORD });
        const sheets = workbook.sheets();
        let allData = [];

        sheets.forEach(sheet => {
            const sheetName = sheet.name();
            const usedRange = sheet.usedRange();
            if (usedRange) {
                const data = usedRange.value();
                if (data && data.length > 1) {
                    const headers = data[0];
                    const rows = data.slice(1);
                    const sheetRows = rows.map(row => {
                        const obj = { _sheet: sheetName }; // Add sheet name metadata
                        headers.forEach((header, index) => {
                            if (header) {
                                let value = row[index];
                                if (typeof value === 'string' && (value.startsWith('{') || value.startsWith('['))) {
                                    value = parseJsonField(value);
                                }
                                const normalizedHeader = header.replace(/\s+/g, '_').replace(/\//g, '_');
                                obj[normalizedHeader] = value !== undefined ? value : null;
                            }
                        });
                        return obj;
                    });
                    allData = allData.concat(sheetRows);
                }
            }
        });
        return allData;
    } catch (error) {
        console.error(`Error reading all sheets from ${filePath}:`, error.message);
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
// MCP HELPER FUNCTIONS
// ============================================

// Parse period string into start/end dates
// Month name mapping for specific month parsing
const MONTH_MAP = {
    'jan': 0, 'january': 0,
    'feb': 1, 'february': 1,
    'mar': 2, 'march': 2,
    'apr': 3, 'april': 3,
    'may': 4,
    'jun': 5, 'june': 5,
    'jul': 6, 'july': 6,
    'aug': 7, 'august': 7,
    'sep': 8, 'sept': 8, 'september': 8,
    'oct': 9, 'october': 9,
    'nov': 10, 'november': 10,
    'dec': 11, 'december': 11
};

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'];

function parsePeriod(period) {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    // Normalize period - handle various formats
    const p = (period || '').toLowerCase().trim().replace(/\s+/g, '_').replace(/-/g, '_');

    switch (p) {
        case 'today': {
            return {
                start: today,
                end: new Date(today.getFullYear(), today.getMonth(), today.getDate(), 23, 59, 59, 999),
                label: 'Today'
            };
        }
        case 'yesterday': {
            const yesterday = new Date(today);
            yesterday.setDate(yesterday.getDate() - 1);
            return {
                start: yesterday,
                end: new Date(yesterday.getFullYear(), yesterday.getMonth(), yesterday.getDate(), 23, 59, 59, 999),
                label: 'Yesterday'
            };
        }
        case 'week':
        case 'this_week':
        case 'last_7_days': {
            const startOfWeek = new Date(today);
            startOfWeek.setDate(today.getDate() - 7);
            return { start: startOfWeek, end: now, label: 'Last 7 Days' };
        }
        case 'last_week':
        case 'previous_week': {
            const endOfLastWeek = new Date(today);
            endOfLastWeek.setDate(today.getDate() - today.getDay()); // Go to last Sunday
            endOfLastWeek.setHours(23, 59, 59, 999);
            const startOfLastWeek = new Date(endOfLastWeek);
            startOfLastWeek.setDate(endOfLastWeek.getDate() - 6);
            startOfLastWeek.setHours(0, 0, 0, 0);
            return { start: startOfLastWeek, end: endOfLastWeek, label: 'Last Week' };
        }
        case 'month':
        case 'this_month': {
            const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
            return { start: startOfMonth, end: now, label: 'This Month' };
        }
        case 'last_month':
        case 'previous_month': {
            const startOfLastMonth = new Date(today.getFullYear(), today.getMonth() - 1, 1);
            const endOfLastMonth = new Date(today.getFullYear(), today.getMonth(), 0, 23, 59, 59, 999);
            return { start: startOfLastMonth, end: endOfLastMonth, label: 'Last Month' };
        }
        case 'last_3_months':
        case 'quarter': {
            const threeMonthsAgo = new Date(today.getFullYear(), today.getMonth() - 3, 1);
            return { start: threeMonthsAgo, end: now, label: 'Last 3 Months' };
        }
        case 'last_6_months':
        case 'half_year': {
            const sixMonthsAgo = new Date(today.getFullYear(), today.getMonth() - 6, 1);
            return { start: sixMonthsAgo, end: now, label: 'Last 6 Months' };
        }
        case 'year':
        case 'this_year': {
            const startOfYear = new Date(today.getFullYear(), 0, 1);
            return { start: startOfYear, end: now, label: 'This Year' };
        }
        case 'last_year':
        case 'previous_year': {
            const startOfLastYear = new Date(today.getFullYear() - 1, 0, 1);
            const endOfLastYear = new Date(today.getFullYear() - 1, 11, 31, 23, 59, 59, 999);
            return { start: startOfLastYear, end: endOfLastYear, label: 'Last Year' };
        }
        case 'last_30_days': {
            const thirtyDaysAgo = new Date(today);
            thirtyDaysAgo.setDate(today.getDate() - 30);
            return { start: thirtyDaysAgo, end: now, label: 'Last 30 Days' };
        }
        case 'last_90_days': {
            const ninetyDaysAgo = new Date(today);
            ninetyDaysAgo.setDate(today.getDate() - 90);
            return { start: ninetyDaysAgo, end: now, label: 'Last 90 Days' };
        }
        case 'all':
        case 'all_time':
            return { start: null, end: null, label: 'All Time' };
        default: {
            // Week number mapping
            const WEEK_NUM_MAP = {
                'first': 1, '1st': 1, 'one': 1, '1': 1,
                'second': 2, '2nd': 2, 'two': 2, '2': 2,
                'third': 3, '3rd': 3, 'three': 3, '3': 3,
                'fourth': 4, '4th': 4, 'four': 4, '4': 4,
                'fifth': 5, '5th': 5, 'five': 5, '5': 5,
                'last': -1
            };

            // Helper function to get week dates within a month
            function getWeekOfMonth(year, monthIndex, weekNum) {
                const firstDay = new Date(year, monthIndex, 1);
                const lastDay = new Date(year, monthIndex + 1, 0);
                const totalDays = lastDay.getDate();
                
                let startDay, endDay;
                
                if (weekNum === -1) {
                    // Last week of month (last 7 days)
                    endDay = totalDays;
                    startDay = Math.max(1, totalDays - 6);
                } else {
                    // Week 1 = days 1-7, Week 2 = days 8-14, etc.
                    startDay = (weekNum - 1) * 7 + 1;
                    endDay = Math.min(weekNum * 7, totalDays);
                    
                    if (startDay > totalDays) {
                        return null; // Invalid week number
                    }
                }
                
                const start = new Date(year, monthIndex, startDay);
                const end = new Date(year, monthIndex, endDay, 23, 59, 59, 999);
                return { start, end };
            }

            // Pattern W1: week_N_month_year (e.g., week_1_november_2024, week_2_dec_2024)
            const weekMonthYearMatch = p.match(/^week_(\w+)_([a-z]+)_(\d{4})$/);
            if (weekMonthYearMatch) {
                const weekKey = weekMonthYearMatch[1];
                const monthName = weekMonthYearMatch[2];
                const year = parseInt(weekMonthYearMatch[3]);
                const weekNum = WEEK_NUM_MAP[weekKey] || parseInt(weekKey);
                
                if (MONTH_MAP[monthName] !== undefined && weekNum && year >= 2000 && year <= 2100) {
                    const monthIndex = MONTH_MAP[monthName];
                    const weekDates = getWeekOfMonth(year, monthIndex, weekNum);
                    if (weekDates) {
                        const weekLabel = weekNum === -1 ? 'Last' : `Week ${weekNum}`;
                        return { ...weekDates, label: `${weekLabel} of ${MONTH_NAMES[monthIndex]} ${year}` };
                    }
                }
            }

            // Pattern W2: first_week_month_year, second_week_november_2024, etc.
            const ordinalWeekMatch = p.match(/^(\w+)_week_([a-z]+)_(\d{4})$/);
            if (ordinalWeekMatch) {
                const weekKey = ordinalWeekMatch[1];
                const monthName = ordinalWeekMatch[2];
                const year = parseInt(ordinalWeekMatch[3]);
                const weekNum = WEEK_NUM_MAP[weekKey];
                
                if (MONTH_MAP[monthName] !== undefined && weekNum && year >= 2000 && year <= 2100) {
                    const monthIndex = MONTH_MAP[monthName];
                    const weekDates = getWeekOfMonth(year, monthIndex, weekNum);
                    if (weekDates) {
                        const weekLabel = weekNum === -1 ? 'Last Week' : `Week ${weekNum}`;
                        return { ...weekDates, label: `${weekLabel} of ${MONTH_NAMES[monthIndex]} ${year}` };
                    }
                }
            }

            // Pattern W3: first_week_month, week_2_november (current/last year)
            const weekMonthMatch = p.match(/^(?:week_)?(\w+)_week_([a-z]+)$/) || p.match(/^week_(\w+)_([a-z]+)$/);
            if (weekMonthMatch) {
                const weekKey = weekMonthMatch[1];
                const monthName = weekMonthMatch[2];
                const weekNum = WEEK_NUM_MAP[weekKey] || parseInt(weekKey);
                
                if (MONTH_MAP[monthName] !== undefined && weekNum) {
                    const monthIndex = MONTH_MAP[monthName];
                    const year = monthIndex > today.getMonth() ? today.getFullYear() - 1 : today.getFullYear();
                    const weekDates = getWeekOfMonth(year, monthIndex, weekNum);
                    if (weekDates) {
                        const weekLabel = weekNum === -1 ? 'Last Week' : `Week ${weekNum}`;
                        return { ...weekDates, label: `${weekLabel} of ${MONTH_NAMES[monthIndex]} ${year}` };
                    }
                }
            }

            // Pattern W4: first_week_of_month, last_week_of_december
            const weekOfMonthMatch = p.match(/^(\w+)_week_of_([a-z]+)(?:_(\d{4}))?$/);
            if (weekOfMonthMatch) {
                const weekKey = weekOfMonthMatch[1];
                const monthName = weekOfMonthMatch[2];
                const yearStr = weekOfMonthMatch[3];
                const weekNum = WEEK_NUM_MAP[weekKey] || parseInt(weekKey);
                
                if (MONTH_MAP[monthName] !== undefined && weekNum) {
                    const monthIndex = MONTH_MAP[monthName];
                    let year = yearStr ? parseInt(yearStr) : (monthIndex > today.getMonth() ? today.getFullYear() - 1 : today.getFullYear());
                    const weekDates = getWeekOfMonth(year, monthIndex, weekNum);
                    if (weekDates) {
                        const weekLabel = weekNum === -1 ? 'Last Week' : `Week ${weekNum}`;
                        return { ...weekDates, label: `${weekLabel} of ${MONTH_NAMES[monthIndex]} ${year}` };
                    }
                }
            }

            // Pattern W5: week_N_year_month (e.g., week_1_2024_11)
            const weekYearMonthMatch = p.match(/^week_(\w+)_(\d{4})_(\d{1,2})$/);
            if (weekYearMonthMatch) {
                const weekKey = weekYearMonthMatch[1];
                const year = parseInt(weekYearMonthMatch[2]);
                const month = parseInt(weekYearMonthMatch[3]);
                const weekNum = WEEK_NUM_MAP[weekKey] || parseInt(weekKey);
                
                if (month >= 1 && month <= 12 && weekNum && year >= 2000 && year <= 2100) {
                    const monthIndex = month - 1;
                    const weekDates = getWeekOfMonth(year, monthIndex, weekNum);
                    if (weekDates) {
                        const weekLabel = weekNum === -1 ? 'Last Week' : `Week ${weekNum}`;
                        return { ...weekDates, label: `${weekLabel} of ${MONTH_NAMES[monthIndex]} ${year}` };
                    }
                }
            }

            // Try to parse specific month/year formats:
            // Format: "november_2024", "nov_2024", "11_2024", "2024_11", "2024_november"
            
            // Pattern 1: month_year (e.g., november_2024, nov_2024)
            const monthYearMatch = p.match(/^([a-z]+)_(\d{4})$/);
            if (monthYearMatch) {
                const monthName = monthYearMatch[1];
                const year = parseInt(monthYearMatch[2]);
                if (MONTH_MAP[monthName] !== undefined && year >= 2000 && year <= 2100) {
                    const monthIndex = MONTH_MAP[monthName];
                    const start = new Date(year, monthIndex, 1);
                    const end = new Date(year, monthIndex + 1, 0, 23, 59, 59, 999);
                    return { start, end, label: `${MONTH_NAMES[monthIndex]} ${year}` };
                }
            }

            // Pattern 2: year_month (e.g., 2024_november, 2024_nov)
            const yearMonthMatch = p.match(/^(\d{4})_([a-z]+)$/);
            if (yearMonthMatch) {
                const year = parseInt(yearMonthMatch[1]);
                const monthName = yearMonthMatch[2];
                if (MONTH_MAP[monthName] !== undefined && year >= 2000 && year <= 2100) {
                    const monthIndex = MONTH_MAP[monthName];
                    const start = new Date(year, monthIndex, 1);
                    const end = new Date(year, monthIndex + 1, 0, 23, 59, 59, 999);
                    return { start, end, label: `${MONTH_NAMES[monthIndex]} ${year}` };
                }
            }

            // Pattern 3: numeric month_year (e.g., 11_2024)
            const numMonthYearMatch = p.match(/^(\d{1,2})_(\d{4})$/);
            if (numMonthYearMatch) {
                const month = parseInt(numMonthYearMatch[1]);
                const year = parseInt(numMonthYearMatch[2]);
                if (month >= 1 && month <= 12 && year >= 2000 && year <= 2100) {
                    const monthIndex = month - 1;
                    const start = new Date(year, monthIndex, 1);
                    const end = new Date(year, monthIndex + 1, 0, 23, 59, 59, 999);
                    return { start, end, label: `${MONTH_NAMES[monthIndex]} ${year}` };
                }
            }

            // Pattern 4: year_numeric month (e.g., 2024_11)
            const yearNumMonthMatch = p.match(/^(\d{4})_(\d{1,2})$/);
            if (yearNumMonthMatch) {
                const year = parseInt(yearNumMonthMatch[1]);
                const month = parseInt(yearNumMonthMatch[2]);
                if (month >= 1 && month <= 12 && year >= 2000 && year <= 2100) {
                    const monthIndex = month - 1;
                    const start = new Date(year, monthIndex, 1);
                    const end = new Date(year, monthIndex + 1, 0, 23, 59, 59, 999);
                    return { start, end, label: `${MONTH_NAMES[monthIndex]} ${year}` };
                }
            }

            // Pattern 5: year only (e.g., 2024, 2023)
            const yearOnlyMatch = p.match(/^(\d{4})$/);
            if (yearOnlyMatch) {
                const year = parseInt(yearOnlyMatch[1]);
                if (year >= 2000 && year <= 2100) {
                    const start = new Date(year, 0, 1);
                    const end = new Date(year, 11, 31, 23, 59, 59, 999);
                    return { start, end, label: `Year ${year}` };
                }
            }

            // Pattern 6: just month name for current year (e.g., "november", "oct")
            if (MONTH_MAP[p] !== undefined) {
                const monthIndex = MONTH_MAP[p];
                const year = today.getFullYear();
                // If the month is in the future, use last year
                const useYear = monthIndex > today.getMonth() ? year - 1 : year;
                const start = new Date(useYear, monthIndex, 1);
                const end = new Date(useYear, monthIndex + 1, 0, 23, 59, 59, 999);
                return { start, end, label: `${MONTH_NAMES[monthIndex]} ${useYear}` };
            }

            // Default to all time
            return { start: null, end: null, label: 'All Time' };
        }
    }
}

// Universal data fetcher for MCP tools (Redis first, then fallback)
// Returns standardized array of objects
async function getMcpData(dataType) {
    // For rewards and travelbuddy, use optimized per-sheet loaders
    if (dataType === 'rewards') {
        return await getRewardsData();
    }
    if (dataType === 'travelbuddy') {
        return await getTravelBuddyData();
    }

    // Memory cache keys for smaller files
    const memKey = `mem:${dataType}:default`;
    
    // 1. Check memory cache first (fastest)
    const memCached = getFromMemoryCache(memKey);
    if (memCached) {
        return memCached;
    }

    // Cache key mapping for smaller files
    const CACHE_KEYS = {
        remittance: 'remittance:sheet1',
        transactions: 'transactions:sheet1'
    };

    const cacheKey = CACHE_KEYS[dataType];

    // 2. Try to get from Redis cache
    if (cacheKey) {
        const cached = await getFromCache(cacheKey);
        if (cached && cached.data && Array.isArray(cached.data)) {
            // Store in memory for faster subsequent access
            setToMemoryCache(memKey, cached.data);
            return cached.data;
        }
    }

    // 3. Fallback: Read from Excel and CACHE the result for future requests
    console.log(`MCP Fallback: Reading ${dataType} from Excel...`);

    let data = [];
    let cacheResponse = null;

    if (dataType === 'remittance') {
        data = await readExcelSheet(EXCEL_FILES.remittance);
        cacheResponse = {
            success: true,
            message: "Remittance history fetched successfully",
            filter_period: 'All Time',
            total_records: data.length,
            summary: calculateStats(data, ['total_amount_in_BHD', 'amount']),
            data: data
        };
    } else if (dataType === 'transactions') {
        data = await readExcelSheet(EXCEL_FILES.transactions);
        cacheResponse = {
            success: true,
            message: "Transaction history fetched successfully",
            filter_period: 'All Time',
            total_records: data.length,
            summary: calculateStats(data, ['transaction_amount', 'amount', 'Amount']),
            data: data
        };
    }

    // Cache in both memory and Redis
    setToMemoryCache(memKey, data);
    if (cacheKey && cacheResponse) {
        setToCache(cacheKey, cacheResponse).catch(err => 
            console.error(`Failed to cache ${dataType}:`, err.message)
        );
    }

    return data;
}

// Helper to filter data by date range
function filterByDate(data, dateRange, dateField) {
    if (!dateRange.start && !dateRange.end) return data;

    return data.filter(item => {
        const itemDate = parseDate(item[dateField]);
        if (!itemDate) return false;
        if (dateRange.start && itemDate < dateRange.start) return false;
        if (dateRange.end && itemDate > dateRange.end) return false;
        return true;
    });
}

// Convert amount to number safely
function parseAmount(val) {
    if (typeof val === 'number') return val;
    if (typeof val === 'string') return parseFloat(val.replace(/,/g, '')) || 0;
    return 0;
}

// Case-insensitive string comparison helper
function equalsIgnoreCase(str, target) {
    return (str || '').toUpperCase() === target.toUpperCase();
}

// Check if transaction is a debit (spending)
function isDebit(t) {
    const cd = (t.credit_debit || '').toUpperCase();
    return cd === 'DEBIT' || cd === 'D';
}

// Check if transaction is a credit (income)
function isCredit(t) {
    const cd = (t.credit_debit || '').toUpperCase();
    return cd === 'CREDIT' || cd === 'C';
}

// Check if transaction is a LOAD type
function isLoad(t) {
    return equalsIgnoreCase(t.transactionType_dsc, 'LOAD');
}

// Get best available amount field from transaction (always returns absolute value)
function getTxnAmount(t) {
    const amt = parseAmount(t.Transacted_Amount_in_BHD || t.Amount || t.BHD_Amount || t.transaction_amount || t.amount || t.txn_amt || t.bill_amt);
    return Math.abs(amt);
}

// ============================================
// MCP API ENDPOINTS - SPENDING & BUDGET
// ============================================

const MCP_BASE = '/api/mcp';

// 1. Spend Summary
/**
 * @swagger
 * /api/mcp/spend/summary:
 *   get:
 *     summary: Get total spending summary
 *     description: Returns total spending, income, and net balance for a specified period.
 *     tags: [Spending]
 *     parameters:
 *       - in: query
 *         name: period
 *         schema:
 *           type: string
 *           enum: [yesterday, week, month, last_month, year]
 *         description: Time period for the summary (default is all time)
 *       - in: query
 *         name: type
 *         required: true
 *         schema:
 *           type: string
 *           enum: [transactions, travelbuddy]
 *         description: Data source - 'transactions' for main transactions or 'travelbuddy' for travel buddy transactions
 *       - in: query
 *         name: subtype
 *         schema:
 *           type: string
 *           enum: [combine]
 *         description: For travelbuddy only - use 'combine' to include both Load and Transaction sheets
 *     responses:
 *       200:
 *         description: Successful response
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 tool:
 *                   type: string
 *                 period:
 *                   type: string
 *                 type:
 *                   type: string
 *                 summary:
 *                   type: object
 *                   properties:
 *                     total_spent:
 *                       type: number
 *                     total_income:
 *                       type: number
 *                     net:
 *                       type: number
 *                     transaction_count:
 *                       type: integer
 */
app.get(`${MCP_BASE}/spend/summary`, async (req, res) => {
    try {
        const { period, type, subtype } = req.query;
        
        // Validate type parameter
        if (!type || !['transactions', 'travelbuddy'].includes(type)) {
            return res.status(400).json({
                success: false,
                error: "Parameter 'type' is required. Use 'transactions' or 'travelbuddy'."
            });
        }
        
        const dateRange = parsePeriod(period);

        let totalSpent = 0;
        let totalIncome = 0;
        let txnCount = 0;

        if (type === 'transactions') {
            // Fetch main transactions only
            const txns = await getMcpData('transactions');

            // Filter valid spending transactions (debits)
            const mainSpend = txns.filter(t => isDebit(t) && getTxnAmount(t) > 0);
            const filteredMain = filterByDate(mainSpend, dateRange, 'transaction_date_time');

            filteredMain.forEach(t => {
                totalSpent += getTxnAmount(t);
                txnCount++;
            });

            // Calculate Income from main transactions (Credit)
            const mainIncome = txns.filter(t => isCredit(t));
            const filteredIncome = filterByDate(mainIncome, dateRange, 'transaction_date_time');
            filteredIncome.forEach(t => totalIncome += getTxnAmount(t));

        } else if (type === 'travelbuddy') {
            // Fetch travelbuddy transactions only
            const travelTxns = await getMcpData('travelbuddy');

            if (subtype === 'combine') {
                // Combine Load and Transaction sheets
                // Load transactions count as income
                const loadTxns = travelTxns.filter(t => isLoad(t) && getTxnAmount(t) > 0);
                const filteredLoads = filterByDate(loadTxns, dateRange, 'Txn_Date');
                filteredLoads.forEach(t => {
                    totalIncome += getTxnAmount(t);
                    txnCount++;
                });

                // Spend transactions (not loads)
                const spendTxns = travelTxns.filter(t => !isLoad(t) && getTxnAmount(t) > 0);
                const filteredSpend = filterByDate(spendTxns, dateRange, 'Txn_Date');
                filteredSpend.forEach(t => {
                    totalSpent += getTxnAmount(t);
                    txnCount++;
                });
            } else {
                // Default: Only Transaction sheet (spend), no loads
                const spendTxns = travelTxns.filter(t => !isLoad(t) && getTxnAmount(t) > 0);
                const filteredSpend = filterByDate(spendTxns, dateRange, 'Txn_Date');
                filteredSpend.forEach(t => {
                    totalSpent += getTxnAmount(t);
                    txnCount++;
                });
            }
        }

        res.json({
            success: true,
            tool: 'spend_summary',
            period: dateRange.label,
            type: type,
            subtype: subtype || 'default',
            summary: {
                total_spent: Math.round(totalSpent * 100) / 100,
                total_income: Math.round(totalIncome * 100) / 100,
                net: Math.round((totalIncome - totalSpent) * 100) / 100,
                transaction_count: txnCount
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// 1b. Detailed Spend Breakdown (comprehensive view)
/**
 * @swagger
 * /api/mcp/spend/detailed-breakdown:
 *   get:
 *     summary: Get comprehensive detailed spending breakdown
 *     description: Returns complete spending breakdown including summary, categories, top merchants, and daily timeline in one call.
 *     tags: [Spending]
 *     parameters:
 *       - in: query
 *         name: type
 *         required: true
 *         schema:
 *           type: string
 *           enum: [transactions, travelbuddy]
 *         description: Data source - 'transactions' for main wallet or 'travelbuddy' for travel card
 *       - in: query
 *         name: period
 *         schema:
 *           type: string
 *         description: Time period for the breakdown (e.g., october_2025, last_month)
 *     responses:
 *       200:
 *         description: Comprehensive spending breakdown
 */
app.get(`${MCP_BASE}/spend/detailed-breakdown`, async (req, res) => {
    try {
        const { period, type } = req.query;
        
        // Validate type parameter
        if (!type || !['transactions', 'travelbuddy'].includes(type)) {
            return res.status(400).json({
                success: false,
                error: "Parameter 'type' is required. Use 'transactions' or 'travelbuddy'."
            });
        }
        
        const dateRange = parsePeriod(period);
        
        let totalSpent = 0;
        let totalIncome = 0;
        let txnCount = 0;
        const categoryMap = {};
        const merchantMap = {};
        const dailyStats = {};
        const transactionTypes = {};

        if (type === 'transactions') {
            const txns = await getMcpData('transactions');
            
            // Filter debits (spending)
            const debitTxns = txns.filter(t => isDebit(t));
            const filteredDebits = filterByDate(debitTxns, dateRange, 'transaction_date_time');
            
            filteredDebits.forEach(t => {
                const amt = Math.abs(getTxnAmount(t));
                totalSpent += amt;
                txnCount++;
                
                // Category breakdown
                let cat = t.MCC_Category || t.mcc_description || t.transaction_type || 'Uncategorized';
                if (!cat || typeof cat === 'object') cat = 'Uncategorized';
                cat = String(cat).trim();
                if (cat.length < 3) cat = 'General';
                if (!categoryMap[cat]) categoryMap[cat] = { amount: 0, count: 0 };
                categoryMap[cat].amount += amt;
                categoryMap[cat].count++;
                
                // Merchant breakdown
                let merchant = t.description || t.merchant_name || t.transaction_description || 'Unknown';
                merchant = String(merchant).trim();
                if (!merchant || merchant === '') merchant = 'Unknown';
                if (!merchantMap[merchant]) merchantMap[merchant] = { amount: 0, count: 0 };
                merchantMap[merchant].amount += amt;
                merchantMap[merchant].count++;
                
                // Daily breakdown
                const date = parseDate(t.transaction_date_time);
                if (date) {
                    const key = date.toISOString().split('T')[0];
                    if (!dailyStats[key]) dailyStats[key] = 0;
                    dailyStats[key] += amt;
                }
                
                // Transaction type breakdown
                const txnType = t.transaction_type || 'OTHER';
                if (!transactionTypes[txnType]) transactionTypes[txnType] = { amount: 0, count: 0 };
                transactionTypes[txnType].amount += amt;
                transactionTypes[txnType].count++;
            });
            
            // Calculate income (credits)
            const creditTxns = txns.filter(t => isCredit(t));
            const filteredCredits = filterByDate(creditTxns, dateRange, 'transaction_date_time');
            filteredCredits.forEach(t => totalIncome += getTxnAmount(t));
            
        } else if (type === 'travelbuddy') {
            const travelTxns = await getMcpData('travelbuddy');
            
            // Filter spend transactions (not loads)
            const spendTxns = travelTxns.filter(t => !isLoad(t) && getTxnAmount(t) > 0);
            const filtered = filterByDate(spendTxns, dateRange, 'Txn_Date');
            
            filtered.forEach(t => {
                const amt = Math.abs(getTxnAmount(t));
                totalSpent += amt;
                txnCount++;
                
                // Category breakdown
                let cat = t.mcc_category || t.MCC_Category || t.mcc_name || 'Uncategorized';
                if (!cat || typeof cat === 'object') cat = 'Uncategorized';
                cat = String(cat).trim();
                if (cat.length < 3) cat = 'General';
                if (!categoryMap[cat]) categoryMap[cat] = { amount: 0, count: 0 };
                categoryMap[cat].amount += amt;
                categoryMap[cat].count++;
                
                // Merchant breakdown
                let merchant = t.otherPartyName || t.merchant_name || t.description || 'Unknown';
                merchant = String(merchant).trim();
                if (!merchant || merchant === '') merchant = 'Unknown';
                if (!merchantMap[merchant]) merchantMap[merchant] = { amount: 0, count: 0 };
                merchantMap[merchant].amount += amt;
                merchantMap[merchant].count++;
                
                // Daily breakdown
                const date = parseDate(t.Txn_Date);
                if (date) {
                    const key = date.toISOString().split('T')[0];
                    if (!dailyStats[key]) dailyStats[key] = 0;
                    dailyStats[key] += amt;
                }
                
                // Transaction type breakdown
                const txnType = t.transactionType_dsc || 'OTHER';
                if (!transactionTypes[txnType]) transactionTypes[txnType] = { amount: 0, count: 0 };
                transactionTypes[txnType].amount += amt;
                transactionTypes[txnType].count++;
            });
            
            // Calculate loads as income
            const loadTxns = travelTxns.filter(t => isLoad(t) && getTxnAmount(t) > 0);
            const filteredLoads = filterByDate(loadTxns, dateRange, 'Txn_Date');
            filteredLoads.forEach(t => totalIncome += getTxnAmount(t));
        }

        // Format categories (top 10)
        const categories = Object.entries(categoryMap)
            .map(([category, stats]) => ({
                category,
                amount: Math.round(stats.amount * 100) / 100,
                transaction_count: stats.count,
                percentage: Math.round((stats.amount / totalSpent) * 100)
            }))
            .sort((a, b) => b.amount - a.amount)
            .slice(0, 10);

        // Format merchants (top 10)
        const merchants = Object.entries(merchantMap)
            .map(([name, stats]) => ({
                merchant: name,
                amount: Math.round(stats.amount * 100) / 100,
                transaction_count: stats.count
            }))
            .sort((a, b) => b.amount - a.amount)
            .slice(0, 10);

        // Format daily timeline
        const dailyTimeline = Object.entries(dailyStats)
            .sort((a, b) => a[0].localeCompare(b[0]))
            .map(([date, amount]) => ({
                date,
                amount: Math.round(amount * 100) / 100
            }));

        // Format transaction types
        const txnTypes = Object.entries(transactionTypes)
            .map(([type, stats]) => ({
                type,
                amount: Math.round(stats.amount * 100) / 100,
                count: stats.count
            }))
            .sort((a, b) => b.amount - a.amount);

        res.json({
            success: true,
            tool: 'spend_detailed_breakdown',
            period: dateRange.label,
            type: type,
            summary: {
                total_spent: Math.round(totalSpent * 100) / 100,
                total_income: Math.round(totalIncome * 100) / 100,
                net: Math.round((totalIncome - totalSpent) * 100) / 100,
                transaction_count: txnCount
            },
            by_category: categories,
            top_merchants: merchants,
            by_transaction_type: txnTypes,
            daily_timeline: dailyTimeline
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// 2. Spend By Category
/**
 * @swagger
 * /api/mcp/spend/by-category:
 *   get:
 *     summary: Get spending breakdown by category
 *     description: Returns spending categorized by MCC or description.
 *     tags: [Spending]
 *     parameters:
 *       - in: query
 *         name: type
 *         required: true
 *         schema:
 *           type: string
 *           enum: [transactions, travelbuddy]
 *         description: Data source - 'transactions' for main wallet or 'travelbuddy' for travel card
 *       - in: query
 *         name: period
 *         schema:
 *           type: string
 *           enum: [yesterday, week, month, last_month, year]
 *         description: Time period for the breakdown
 *     responses:
 *       200:
 *         description: Successful response
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 tool:
 *                   type: string
 *                 period:
 *                   type: string
 *                 type:
 *                   type: string
 *                 categories:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       category:
 *                         type: string
 *                       amount:
 *                         type: number
 */
app.get(`${MCP_BASE}/spend/by-category`, async (req, res) => {
    try {
        const { period, type } = req.query;
        
        // Validate type parameter
        if (!type || !['transactions', 'travelbuddy'].includes(type)) {
            return res.status(400).json({
                success: false,
                error: "Parameter 'type' is required. Use 'transactions' or 'travelbuddy'."
            });
        }
        
        const dateRange = parsePeriod(period);
        const categoryMap = {};

        if (type === 'transactions') {
            const txns = await getMcpData('transactions');
            const debitTxns = txns.filter(t => isDebit(t));
            const filtered = filterByDate(debitTxns, dateRange, 'transaction_date_time');

            filtered.forEach(t => {
                let cat = t.MCC_Category || t.mcc_description || 'Uncategorized';
                if (!cat || typeof cat === 'object') {
                    cat = 'Uncategorized';
                } else {
                    cat = String(cat).trim();
                }
                if (cat.length < 3) cat = 'General';

                const amt = getTxnAmount(t);
                if (!categoryMap[cat]) categoryMap[cat] = 0;
                categoryMap[cat] += amt;
            });
        } else if (type === 'travelbuddy') {
            const travelTxns = await getMcpData('travelbuddy');
            // Filter for spend transactions only (not loads)
            const spendTxns = travelTxns.filter(t => !isLoad(t) && getTxnAmount(t) > 0);
            const filtered = filterByDate(spendTxns, dateRange, 'Txn_Date');

            filtered.forEach(t => {
                let cat = t.mcc_category || t.MCC_Category || t.mcc_name || 'Uncategorized';
                if (!cat || typeof cat === 'object') {
                    cat = 'Uncategorized';
                } else {
                    cat = String(cat).trim();
                }
                if (cat.length < 3) cat = 'General';

                const amt = getTxnAmount(t);
                if (!categoryMap[cat]) categoryMap[cat] = 0;
                categoryMap[cat] += amt;
            });
        }

        // Sort by amount desc
        const categories = Object.entries(categoryMap)
            .map(([category, amount]) => ({
                category,
                amount: Math.round(amount * 100) / 100
            }))
            .sort((a, b) => b.amount - a.amount);

        res.json({
            success: true,
            tool: 'spend_by_category',
            period: dateRange.label,
            type: type,
            categories: categories.slice(0, 15) // Top 15 categories
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// 3. Top Merchants
/**
 * @swagger
 * /api/mcp/spend/top-merchants:
 *   get:
 *     summary: Get top merchants by spend
 *     tags: [Spending]
 *     parameters:
 *       - in: query
 *         name: type
 *         required: true
 *         schema:
 *           type: string
 *           enum: [transactions, travelbuddy]
 *         description: Data source - 'transactions' for main wallet or 'travelbuddy' for travel card
 *       - in: query
 *         name: period
 *         schema: { type: string }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 10 }
 *     responses:
 *       200:
 *         description: List of top merchants
 */
app.get(`${MCP_BASE}/spend/top-merchants`, async (req, res) => {
    try {
        const { period, limit = 10, type } = req.query;
        
        // Validate type parameter
        if (!type || !['transactions', 'travelbuddy'].includes(type)) {
            return res.status(400).json({
                success: false,
                error: "Parameter 'type' is required. Use 'transactions' or 'travelbuddy'."
            });
        }
        
        const dateRange = parsePeriod(period);
        const merchantMap = {};

        if (type === 'transactions') {
            const txns = await getMcpData('transactions');
            const debitTxns = txns.filter(t => isDebit(t));
            const filtered = filterByDate(debitTxns, dateRange, 'transaction_date_time');

            filtered.forEach(t => {
                let merchant = t.description || t.merchant_name || t.transaction_description || 'Unknown';
                merchant = String(merchant).trim();
                if (!merchant || merchant === '') merchant = 'Unknown';
                
                const amt = Math.abs(getTxnAmount(t));

                if (!merchantMap[merchant]) merchantMap[merchant] = { amount: 0, count: 0 };
                merchantMap[merchant].amount += amt;
                merchantMap[merchant].count++;
            });
        } else if (type === 'travelbuddy') {
            const travelTxns = await getMcpData('travelbuddy');
            const spendTxns = travelTxns.filter(t => !isLoad(t) && getTxnAmount(t) > 0);
            const filtered = filterByDate(spendTxns, dateRange, 'Txn_Date');

            filtered.forEach(t => {
                let merchant = t.otherPartyName || t.merchant_name || t.description || 'Unknown';
                merchant = String(merchant).trim();
                if (!merchant || merchant === '') merchant = 'Unknown';
                
                const amt = Math.abs(getTxnAmount(t));

                if (!merchantMap[merchant]) merchantMap[merchant] = { amount: 0, count: 0 };
                merchantMap[merchant].amount += amt;
                merchantMap[merchant].count++;
            });
        }

        const merchants = Object.entries(merchantMap)
            .map(([name, stats]) => ({
                merchant: name,
                total_amount: Math.round(stats.amount * 100) / 100,
                transaction_count: stats.count
            }))
            .sort((a, b) => b.total_amount - a.total_amount)
            .slice(0, parseInt(limit));

        res.json({
            success: true,
            tool: 'spend_top_merchants',
            period: dateRange.label,
            type: type,
            merchants
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// 4. Spend Trend (Month over Month)
/**
 * @swagger
 * /api/mcp/spend/trend:
 *   get:
 *     summary: Get spending trend
 *     tags: [Spending]
 *     parameters:
 *       - in: query
 *         name:  
 * 
 * 
 * 
 * 
 *         schema: { type: integer, default: 6 }
 *     responses:
 *       200:
 *         description: Monthly spending trend
 */
app.get(`${MCP_BASE}/spend/trend`, async (req, res) => {
    try {
        const { months = 6 } = req.query; // Last N months
        const numMonths = parseInt(months);
        const now = new Date();

        const txns = await getMcpData('transactions');
        const debitTxns = txns.filter(t => isDebit(t));

        // Group by month YYYY-MM
        const monthStats = {};

        debitTxns.forEach(t => {
            const date = parseDate(t.transaction_date_time);
            if (!date) return;

            // Filter to lookback window
            const monthDiff = (now.getFullYear() - date.getFullYear()) * 12 + (now.getMonth() - date.getMonth());
            if (monthDiff >= numMonths) return;

            const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
            const monthName = getMonthName(date.getMonth() + 1);

            if (!monthStats[key]) monthStats[key] = { month: monthName, year: date.getFullYear(), amount: 0 };
            monthStats[key].amount += getTxnAmount(t);
        });

        const trend = Object.keys(monthStats).sort().map(key => ({
            period: `${monthStats[key].month} ${monthStats[key].year}`,
            amount: Math.round(monthStats[key].amount * 100) / 100
        }));

        res.json({
            success: true,
            tool: 'spend_trend',
            trend
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// 5. Search Transactions
/**
 * @swagger
 * /api/mcp/spend/search:
 *   get:
 *     summary: Search transactions
 *     tags: [Spending]
 *     parameters:
 *       - in: query
 *         name: query
 *         required: true
 *         schema: { type: string }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 5 }
 *       - in: query
 *         name: period
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Search results
 */
app.get(`${MCP_BASE}/spend/search`, async (req, res) => {
    try {
        const { query, limit = 5, period } = req.query;
        if (!query) return res.json({ success: false, message: "Query required" });

        const dateRange = parsePeriod(period);
        const lowerQuery = query.toLowerCase();

        const txns = await getMcpData('transactions');
        const filteredTime = filterByDate(txns, dateRange, 'transaction_date_time');

        const matches = filteredTime.filter(t => {
            const desc = (t.description || '').toLowerCase();
            const txnType = (t.transaction_type || '').toLowerCase();
            const bfcType = (t.bfc_type || '').toLowerCase();
            const subType = (t.sub_transaction_type || '').toLowerCase();
            return desc.includes(lowerQuery) || txnType.includes(lowerQuery) || bfcType.includes(lowerQuery) || subType.includes(lowerQuery);
        });

        const results = matches.slice(0, parseInt(limit)).map(t => ({
            date: t.transaction_date_time,
            description: t.description || t.transaction_type || 'Unknown',
            type: t.transaction_type,
            amount: getTxnAmount(t),
            credit_debit: t.credit_debit
        }));

        res.json({
            success: true,
            tool: 'spend_search',
            query,
            total_matches: matches.length,
            results
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// 6. Subscriptions (Recurring Detector)
/**
 * @swagger
 * /api/mcp/spend/subscriptions:
 *   get:
 *     summary: Detect potential subscriptions
 *     tags: [Spending]
 *     responses:
 *       200:
 *         description: List of potential recurring payments
 */
app.get(`${MCP_BASE}/spend/subscriptions`, async (req, res) => {
    try {
        const txns = await getMcpData('transactions');
        const debitTxns = txns.filter(t => isDebit(t));

        // Logic: Same merchant, similar amount (+/- 5%), regular intervals (approx 30 days)
        // Simplified: Group by merchant + approx amount
        const recurringMap = {};

        debitTxns.forEach(t => {
            const merchant = (t.description || t.merchant_name || 'Unknown').trim();
            if (merchant === 'Unknown') return;

            const amt = Math.abs(getTxnAmount(t));
            if (amt < 1) return; // Ignore tiny amounts

            const key = `${merchant}_${Math.round(amt)}`; // strict amount matching for now

            if (!recurringMap[key]) recurringMap[key] = { merchant, amount: amt, dates: [] };
            recurringMap[key].dates.push(parseDate(t.transaction_date_time));
        });

        const subscriptions = [];

        Object.values(recurringMap).forEach(item => {
            if (item.dates.length >= 3) {
                // Check if they are somewhat monthly
                // Only detecting "Potential" subscriptions
                subscriptions.push({
                    merchant: item.merchant,
                    amount: item.amount,
                    frequency: 'Monthly (Estimated)',
                    confidence: 'Medium'
                });
            }
        });

        res.json({
            success: true,
            tool: 'spend_subscriptions',
            count: subscriptions.length,
            subscriptions
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// 7. Daily Spend
/**
 * @swagger
 * /api/mcp/spend/daily:
 *   get:
 *     summary: Get daily spending timeline
 *     tags: [Spending]
 *     parameters:
 *       - in: query
 *         name: type
 *         required: true
 *         schema:
 *           type: string
 *           enum: [transactions, travelbuddy]
 *         description: Data source - 'transactions' for main wallet or 'travelbuddy' for travel card
 *       - in: query
 *         name: period
 *         schema: { type: string, default: week }
 *     responses:
 *       200:
 *         description: Daily spending amounts
 */
app.get(`${MCP_BASE}/spend/daily`, async (req, res) => {
    try {
        const { period, type } = req.query;
        
        // Validate type parameter
        if (!type || !['transactions', 'travelbuddy'].includes(type)) {
            return res.status(400).json({
                success: false,
                error: "Parameter 'type' is required. Use 'transactions' or 'travelbuddy'."
            });
        }
        
        const dateRange = parsePeriod(period || 'week'); // Default to week
        const dailyStats = {};

        if (type === 'transactions') {
            const txns = await getMcpData('transactions');
            const debitTxns = txns.filter(t => isDebit(t));
            const filtered = filterByDate(debitTxns, dateRange, 'transaction_date_time');

            filtered.forEach(t => {
                const date = parseDate(t.transaction_date_time);
                if (!date) return;

                const key = date.toISOString().split('T')[0]; // YYYY-MM-DD
                if (!dailyStats[key]) dailyStats[key] = 0;
                dailyStats[key] += getTxnAmount(t);
            });
        } else if (type === 'travelbuddy') {
            const travelTxns = await getMcpData('travelbuddy');
            const spendTxns = travelTxns.filter(t => !isLoad(t) && getTxnAmount(t) > 0);
            const filtered = filterByDate(spendTxns, dateRange, 'Txn_Date');

            filtered.forEach(t => {
                const date = parseDate(t.Txn_Date);
                if (!date) return;

                const key = date.toISOString().split('T')[0]; // YYYY-MM-DD
                if (!dailyStats[key]) dailyStats[key] = 0;
                dailyStats[key] += getTxnAmount(t);
            });
        }

        const timeline = Object.entries(dailyStats)
            .sort((a, b) => a[0].localeCompare(b[0]))
            .map(([date, amount]) => ({
                date,
                amount: Math.round(amount * 100) / 100
            }));

        res.json({
            success: true,
            tool: 'spend_daily',
            period: dateRange.label,
            type: type,
            timeline
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// 8. Specific Category Details
/**
 * @swagger
 * /api/mcp/spend/category:
 *   get:
 *     summary: Get specific category details
 *     tags: [Spending]
 *     parameters:
 *       - in: query
 *         name: category
 *         required: true
 *         schema: { type: string }
 *       - in: query
 *         name: period
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Detailed category stats
 */
app.get(`${MCP_BASE}/spend/category`, async (req, res) => {
    try {
        const { category, period, type } = req.query;
        if (!category) return res.json({ success: false, message: "Category required" });
        
        // Validate type parameter
        if (!type || !['transactions', 'travelbuddy'].includes(type)) {
            return res.status(400).json({
                success: false,
                error: "Parameter 'type' is required. Use 'transactions' or 'travelbuddy'."
            });
        }

        const dateRange = parsePeriod(period);
        const lowerCat = category.toLowerCase();
        let matches = [];
        const topMerchants = {};

        if (type === 'transactions') {
            const txns = await getMcpData('transactions');
            const debitTxns = txns.filter(t => isDebit(t));
            const filtered = filterByDate(debitTxns, dateRange, 'transaction_date_time');

            matches = filtered.filter(t =>
                (t.MCC_Category || t.mcc_description || '').toLowerCase().includes(lowerCat)
            );

            matches.forEach(t => {
                const merch = t.description || t.merchant_name || 'Unknown';
                if (!topMerchants[merch]) topMerchants[merch] = 0;
                topMerchants[merch] += Math.abs(getTxnAmount(t));
            });
        } else if (type === 'travelbuddy') {
            const travelTxns = await getMcpData('travelbuddy');
            const spendTxns = travelTxns.filter(t => !isLoad(t) && getTxnAmount(t) > 0);
            const filtered = filterByDate(spendTxns, dateRange, 'Txn_Date');

            matches = filtered.filter(t =>
                (t.mcc_category || t.MCC_Category || t.mcc_name || '').toLowerCase().includes(lowerCat)
            );

            matches.forEach(t => {
                const merch = t.otherPartyName || t.merchant_name || 'Unknown';
                if (!topMerchants[merch]) topMerchants[merch] = 0;
                topMerchants[merch] += Math.abs(getTxnAmount(t));
            });
        }

        const total = matches.reduce((sum, t) => sum + Math.abs(getTxnAmount(t)), 0);

        res.json({
            success: true,
            tool: 'spend_category',
            category_query: category,
            type: type,
            total_amount: Math.round(total * 100) / 100,
            transaction_count: matches.length,
            top_merchants: Object.entries(topMerchants)
                .sort((a, b) => b[1] - a[1])
                .slice(0, 5)
                .map(([name, amt]) => ({ name, amount: Math.round(amt * 100) / 100 }))
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// 9. Unusual Activity
/**
 * @swagger
 * /api/mcp/spend/unusual:
 *   get:
 *     summary: Detect unusual spending activity
 *     tags: [Spending]
 *     parameters:
 *       - in: query
 *         name: period
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: List of unusual large transactions
 */
app.get(`${MCP_BASE}/spend/unusual`, async (req, res) => {
    try {
        // Defined as > 2x average transaction amount or very large single amounts (>500)
        const THRESHOLD = 500;
        const { period } = req.query;
        const dateRange = parsePeriod(period);

        const txns = await getMcpData('transactions');
        const debitTxns = txns.filter(t => isDebit(t));
        const filtered = filterByDate(debitTxns, dateRange, 'transaction_date_time');

        const unusual = filtered
            .filter(t => Math.abs(getTxnAmount(t)) > THRESHOLD)
            .map(t => ({
                date: t.transaction_date_time,
                merchant: t.description || t.merchant_name || 'Unknown',
                amount: Math.abs(getTxnAmount(t)),
                reason: `Amount exceeds ${THRESHOLD}`
            }))
            .sort((a, b) => b.amount - a.amount)
            .slice(0, 10);

        res.json({
            success: true,
            tool: 'spend_unusual',
            count: unusual.length,
            transactions: unusual
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// ============================================
// MCP API ENDPOINTS - TRAVEL
// ============================================

// Helper to deduce trips from transactions
// Returns array of { trip_id: 'country_YYYYMM', country, start_date, end_date, total_spend }
function identifyTrips(travelTxns) {
    if (!travelTxns || travelTxns.length === 0) return [];

    // Sort by date
    const sorted = [...travelTxns].sort((a, b) => {
        const da = parseDate(a.Txn_Date);
        const db = parseDate(b.Txn_Date);
        return da - db;
    });

    const trips = [];
    let currentTrip = null;

    sorted.forEach(t => {
        // Only look at foreign transactions (country != 'Bahrain')
        // Use 'Country' field (capital C) as that's the actual field name in Excel
        let country = t.Country || t.country || 'Unknown';
        
        // Handle cases where country is an error object (e.g., {_error: "#N/A"})
        if (typeof country === 'object') {
            country = 'Unknown';
        }
        
        // Skip records with Unknown or Bahrain
        if (country === 'Bahrain' || country === 'Unknown' || !country) return;

        const date = parseDate(t.Txn_Date);
        if (!date) return;

        // If no current trip or country different or "gap" > 7 days => new trip
        const isDifferentCountry = currentTrip && currentTrip.country !== country;
        const isTimeGap = currentTrip && (date - currentTrip.end_date) > (7 * 24 * 60 * 60 * 1000);

        if (!currentTrip || isDifferentCountry || isTimeGap) {
            if (currentTrip) trips.push(currentTrip);

            // Start new trip
            currentTrip = {
                trip_id: `${country}_${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}_${date.getDate()}`.replace(/\s+/g, ''),
                country: country,
                start_date: date,
                end_date: date,
                transaction_count: 0,
                total_spend: 0
            };
        }

        // Add to current trip
        currentTrip.end_date = date; // extend end date
        currentTrip.transaction_count++;
        // Add amount if it's a spend (not load) - case-insensitive check
        const txnType = (t.transactionType_dsc || '').toUpperCase();
        if (txnType !== 'LOAD') {
            currentTrip.total_spend += parseAmount(t.Amount || t.BHD_Amount || t.amount || t.txn_amt || t.bill_amt);
        }
    });

    if (currentTrip) trips.push(currentTrip);
    return trips;
}

// 10. List Trips
/**
 * @swagger
 * /api/mcp/travel/trips:
 *   get:
 *     summary: List travel trips
 *     description: Identifies trips based on foreign currency transactions.
 *     tags: [Travel]
 *     parameters:
 *       - in: query
 *         name: period
 *         schema: { type: string }
 *         description: Filter by period (e.g., "this month", "last 3 months", "2024", "January")
 *     responses:
 *       200:
 *         description: List of identified trips
 */
app.get(`${MCP_BASE}/travel/trips`, async (req, res) => {
    try {
        const { period } = req.query;
        const dateRange = parsePeriod(period);
        
        let txns = await getMcpData('travelbuddy');
        
        // Filter by period if specified
        if (dateRange.start || dateRange.end) {
            txns = txns.filter(t => {
                const date = parseDate(t.Txn_Date);
                if (!date) return false;
                if (dateRange.start && date < dateRange.start) return false;
                if (dateRange.end && date > dateRange.end) return false;
                return true;
            });
        }
        
        const trips = identifyTrips(txns);

        // Return summary list
        const summary = trips.map(t => ({
            country: t.country,
            dates: `${t.start_date.toISOString().split('T')[0]} to ${t.end_date.toISOString().split('T')[0]}`,
            spend: Math.round(t.total_spend * 100) / 100
        })).sort((a, b) => new Date(b.dates.split(' to ')[0]) - new Date(a.dates.split(' to ')[0])); // Newest first

        res.json({
            success: true,
            tool: 'travel_trips',
            period: dateRange.label,
            count: summary.length,
            trips: summary
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// 11. Trip Spend Details
/**
 * @swagger
 * /api/mcp/travel/trip-spend:
 *   get:
 *     summary: Get details of a specific trip
 *     tags: [Travel]
 *     parameters:
 *       - in: query
 *         name: trip_id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Trip spend details
 */
app.get(`${MCP_BASE}/travel/trip-spend`, async (req, res) => {
    try {
        const { trip_id } = req.query;
        if (!trip_id) return res.json({ success: false, message: "trip_id required" });

        const txns = await getMcpData('travelbuddy');
        const trips = identifyTrips(txns);
        const trip = trips.find(t => t.trip_id === trip_id);

        if (!trip) return res.status(404).json({ success: false, message: "Trip not found" });

        // Filter original transactions for this trip
        // Re-implement simplified matching logic or just filter by date/country
        const tripTxns = txns.filter(t => {
            const date = parseDate(t.Txn_Date);
            const txnType = (t.transactionType_dsc || '').toUpperCase();
            return t.country === trip.country &&
                date >= trip.start_date &&
                date <= trip.end_date &&
                txnType !== 'LOAD';
        });

        // Top categories for this trip
        const catMap = {};
        tripTxns.forEach(t => {
            const cat = t.MCC_Category || t.mcc_description || 'General';
            const amt = parseAmount(t.amount || t.txn_amt || t.bill_amt);
            if (!catMap[cat]) catMap[cat] = 0;
            catMap[cat] += amt;
        });

        res.json({
            success: true,
            tool: 'travel_trip_spend',
            trip: {
                country: trip.country,
                total_spend: Math.round(trip.total_spend * 100) / 100,
                duration_days: Math.ceil((trip.end_date - trip.start_date) / (1000 * 60 * 60 * 24)) + 1
            },
            categories: Object.entries(catMap)
                .map(([name, amount]) => ({ name, amount: Math.round(amount * 100) / 100 }))
                .sort((a, b) => b.amount - a.amount)
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// 12. Load vs Spend (Budgeting)
/**
 * @swagger
 * /api/mcp/travel/load-vs-spend:
 *   get:
 *     summary: Compare travel wallet load vs spend
 *     tags: [Travel]
 *     parameters:
 *       - in: query
 *         name: trip_id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Load vs Spend analysis
 */
app.get(`${MCP_BASE}/travel/load-vs-spend`, async (req, res) => {
    try {
        const { trip_id } = req.query;
        if (!trip_id) return res.json({ success: false, message: "trip_id required" });

        const txns = await getMcpData('travelbuddy');
        const trips = identifyTrips(txns);
        const trip = trips.find(t => t.trip_id === trip_id);

        if (!trip) return res.status(404).json({ success: false, message: "Trip not found" });

        // Find loads for this trip (same country/currency, roughly same time maybe slightly before)
        // Heuristic: Loads in relevant currency around the start date? 
        // Or simplified: Loads where 'country' matches (if 'Load' has country data)
        // Usually Load doesn't have country, but currency. 
        // Let's assume we filter by date range (start - 7 days to end)

        const loadStart = new Date(trip.start_date);
        loadStart.setDate(loadStart.getDate() - 7);

        const tripLoads = txns.filter(t => {
            const date = parseDate(t.Txn_Date);
            const txnType = (t.transactionType_dsc || '').toUpperCase();
            return txnType === 'LOAD' &&
                date >= loadStart &&
                date <= trip.end_date;
        });

        const totalLoaded = tripLoads.reduce((sum, t) => sum + parseAmount(t.amount || t.txn_amt), 0);
        const totalSpent = trip.total_spend;

        res.json({
            success: true,
            tool: 'travel_load_vs_spend',
            trip_id,
            total_loaded: Math.round(totalLoaded * 100) / 100,
            total_spent: Math.round(totalSpent * 100) / 100,
            remaining: Math.round((totalLoaded - totalSpent) * 100) / 100,
            utilization_pct: totalLoaded ? Math.round((totalSpent / totalLoaded) * 100) : 0
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// 13. Compare Trips
/**
 * @swagger
 * /api/mcp/travel/compare:
 *   get:
 *     summary: Compare two trips
 *     tags: [Travel]
 *     parameters:
 *       - in: query
 *         name: trip_id_1
 *         required: true
 *         schema: { type: string }
 *       - in: query
 *         name: trip_id_2
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Trip comparison
 */
app.get(`${MCP_BASE}/travel/compare`, async (req, res) => {
    try {
        const { trip_id_1, trip_id_2 } = req.query;
        if (!trip_id_1 || !trip_id_2) return res.json({ success: false, message: "Two trip IDs required" });

        const txns = await getMcpData('travelbuddy');
        const trips = identifyTrips(txns);
        const t1 = trips.find(t => t.trip_id === trip_id_1);
        const t2 = trips.find(t => t.trip_id === trip_id_2);

        if (!t1 || !t2) return res.status(404).json({ success: false, message: "One or both trips not found" });

        res.json({
            success: true,
            tool: 'travel_compare',
            comparison: {
                trip_1: {
                    country: t1.country,
                    total_spend: Math.round(t1.total_spend * 100) / 100,
                    daily_avg: Math.round((t1.total_spend / ((t1.end_date - t1.start_date) / (86400000) + 1)) * 100) / 100
                },
                trip_2: {
                    country: t2.country,
                    total_spend: Math.round(t2.total_spend * 100) / 100,
                    daily_avg: Math.round((t2.total_spend / ((t2.end_date - t2.start_date) / (86400000) + 1)) * 100) / 100
                },
                difference_spend: Math.round((t1.total_spend - t2.total_spend) * 100) / 100
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// 14. Currency Mix
/**
 * @swagger
 * /api/mcp/travel/currency-mix:
 *   get:
 *     summary: Get currency usage usage for a trip
 *     tags: [Travel]
 *     parameters:
 *       - in: query
 *         name: trip_id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Currency mix analysis
 */
app.get(`${MCP_BASE}/travel/currency-mix`, async (req, res) => {
    try {
        const { trip_id } = req.query;
        if (!trip_id) return res.json({ success: false, message: "trip_id required" });

        const txns = await getMcpData('travelbuddy');
        const trips = identifyTrips(txns);
        const trip = trips.find(t => t.trip_id === trip_id);

        if (!trip) return res.status(404).json({ success: false, message: "Trip not found" });

        // Filter txns for trip
        const tripTxns = txns.filter(t => {
            const date = parseDate(t.Txn_Date);
            const txnType = (t.transactionType_dsc || '').toUpperCase();
            return t.country === trip.country &&
                date >= trip.start_date &&
                date <= trip.end_date &&
                txnType !== 'LOAD';
        });

        const currencyMap = {};
        tripTxns.forEach(t => {
            const curr = t.txn_curr || 'BHD';
            const amt = parseAmount(t.txn_amt || t.amount); // amount in foreign currency
            if (!currencyMap[curr]) currencyMap[curr] = 0;
            currencyMap[curr] += amt;
        });

        res.json({
            success: true,
            tool: 'travel_currency_mix',
            currencies: Object.entries(currencyMap)
                .map(([code, amount]) => ({ code, amount: Math.round(amount * 100) / 100 }))
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// ============================================
// MCP API ENDPOINTS - REMITTANCE
// ============================================

// 15. Remittance Summary
/**
 * @swagger
 * /api/mcp/remittance/summary:
 *   get:
 *     summary: Get remittance summary
 *     tags: [Remittance]
 *     parameters:
 *       - in: query
 *         name: year
 *         schema: { type: integer }
 *       - in: query
 *         name: month
 *         schema: { type: integer }
 *         description: Month number (1-12) for month-wise filtering
 *     responses:
 *       200:
 *         description: Monthly/Yearly remittance summary
 */
app.get(`${MCP_BASE}/remittance/summary`, async (req, res) => {
    try {
        const { year, month } = req.query;
        const targetYear = year ? parseInt(year) : new Date().getFullYear();
        const targetMonth = month ? parseInt(month) : null;

        const txns = await getMcpData('remittance');

        // Filter by year and optionally by month (all transactions)
        const allFilteredTxns = txns.filter(t => {
            const date = parseDate(t.timestamp_created);
            if (!date) return false;
            if (date.getFullYear() !== targetYear) return false;
            if (targetMonth && (date.getMonth() + 1) !== targetMonth) return false;
            return true;
        });

        // Separate successful and failed
        const successfulTxns = allFilteredTxns.filter(t => t.status !== false);
        const failedTxns = allFilteredTxns.filter(t => t.status === false);

        const totalAmount = allFilteredTxns.reduce((sum, t) => sum + parseAmount(t.total_amount_in_BHD), 0);
        const successfulAmount = successfulTxns.reduce((sum, t) => sum + parseAmount(t.total_amount_in_BHD), 0);
        const failedAmount = failedTxns.reduce((sum, t) => sum + parseAmount(t.total_amount_in_BHD), 0);

        // Build period label
        const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
        const periodLabel = targetMonth ? `${MONTH_NAMES[targetMonth - 1]} ${targetYear}` : `Year ${targetYear}`;

        res.json({
            success: true,
            tool: 'remittance_summary',
            period: periodLabel,
            year: targetYear,
            month: targetMonth || null,
            total: {
                count: allFilteredTxns.length,
                amount: Math.round(totalAmount * 100) / 100
            },
            successful: {
                count: successfulTxns.length,
                amount: Math.round(successfulAmount * 100) / 100
            },
            failed: {
                count: failedTxns.length,
                amount: Math.round(failedAmount * 100) / 100
            },
            average_successful_amount: successfulTxns.length ? Math.round((successfulAmount / successfulTxns.length) * 100) / 100 : 0
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// 16. Recipient Stats
/**
 * @swagger
 * /api/mcp/remittance/recipient:
 *   get:
 *     summary: Get stats for a specific recipient
 *     tags: [Remittance]
 *     parameters:
 *       - in: query
 *         name: recipient_name
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Recipient statistics
 */
app.get(`${MCP_BASE}/remittance/recipient`, async (req, res) => {
    try {
        const { recipient_name } = req.query;
        if (!recipient_name) return res.json({ success: false, message: "recipient_name required" });

        const txns = await getMcpData('remittance');
        const lowerName = recipient_name.toLowerCase();

        // Find matches (fuzzy)
        const matches = txns.filter(t =>
            (t.beneficiary_name || '').toLowerCase().includes(lowerName) && t.status !== false
        );

        const totalAmount = matches.reduce((sum, t) => sum + parseAmount(t.total_amount_in_BHD), 0);

        // Last sent date
        let lastSent = null;
        if (matches.length > 0) {
            const sorted = matches.map(t => parseDate(t.timestamp_created)).sort((a, b) => b - a);
            lastSent = sorted[0];
        }

        res.json({
            success: true,
            tool: 'remittance_recipient',
            query: recipient_name,
            total_sent: Math.round(totalAmount * 100) / 100,
            count: matches.length,
            last_sent_date: lastSent,
            // Most common currency
            currency: matches[0] ? matches[0].currency : null
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// 17. Remittance Trend
/**
 * @swagger
 * /api/mcp/remittance/trend:
 *   get:
 *     summary: Get remittance trend over years
 *     tags: [Remittance]
 *     parameters:
 *       - in: query
 *         name: years
 *         schema: { type: integer, default: 3 }
 *     responses:
 *       200:
 *         description: Yearly trend analysis
 */
app.get(`${MCP_BASE}/remittance/trend`, async (req, res) => {
    try {
        const { years = '3' } = req.query; // Last N years
        const numYears = parseInt(years);
        const currentYear = new Date().getFullYear();

        const txns = await getMcpData('remittance');

        const yearlyStats = {};
        for (let i = 0; i < numYears; i++) {
            yearlyStats[currentYear - i] = 0;
        }

        txns.forEach(t => {
            if (t.status === false) return;
            const date = parseDate(t.timestamp_created);
            if (!date) return;

            const y = date.getFullYear();
            if (yearlyStats[y] !== undefined) {
                yearlyStats[y] += parseAmount(t.total_amount_in_BHD);
            }
        });

        res.json({
            success: true,
            tool: 'remittance_trend',
            trend: Object.entries(yearlyStats)
                .sort((a, b) => a[0] - b[0])
                .map(([year, amount]) => ({ year: parseInt(year), amount: Math.round(amount * 100) / 100 }))
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// 18. Search Remittances
/**
 * @swagger
 * /api/mcp/remittance/search:
 *   get:
 *     summary: Search remittance transactions
 *     description: Search by transaction ID, payment mode, payment type, or amount
 *     tags: [Remittance]
 *     parameters:
 *       - in: query
 *         name: query
 *         required: true
 *         schema: { type: string }
 *         description: Search term - matches transaction ID, payment mode, payment type, or amount
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 5 }
 *     responses:
 *       200:
 *         description: Search results
 */
app.get(`${MCP_BASE}/remittance/search`, async (req, res) => {
    try {
        const { query, limit = 5 } = req.query;
        if (!query) return res.json({ success: false, message: "Query required" });

        const lowerQ = query.toLowerCase();
        const txns = await getMcpData('remittance');

        // Search across multiple fields: transactionid, paymentmode, paymenttype, pgreferenceid, amount
        const matches = txns.filter(t =>
            (t.transactionid || '').toLowerCase().includes(lowerQ) ||
            (t.pgreferenceid || '').toLowerCase().includes(lowerQ) ||
            (t.paymentmode || '').toLowerCase().includes(lowerQ) ||
            (t.paymenttype || '').toLowerCase().includes(lowerQ) ||
            (t.biller_name || '').toLowerCase().includes(lowerQ) ||
            String(t.amount || '').includes(lowerQ) ||
            String(t.total_amount_in_BHD || '').includes(lowerQ)
        );

        res.json({
            success: true,
            tool: 'remittance_search',
            query: query,
            count: matches.length,
            matches: matches.slice(0, parseInt(limit)).map(t => ({
                date: t.timestamp_created,
                transaction_id: t.transactionid,
                reference: t.pgreferenceid,
                payment_mode: t.paymentmode,
                payment_type: t.paymenttype,
                amount: t.amount,
                total_bhd: t.total_amount_in_BHD,
                status: t.status ? 'Completed' : 'Pending'
            }))
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// 19. Get FX Rate (Mock)
/**
 * @swagger
 * /api/mcp/remittance/fx-rate:
 *   get:
 *     summary: Get current FX rate
 *     tags: [Remittance]
 *     parameters:
 *       - in: query
 *         name: currency
 *         required: true
 *         schema: { type: string }
 *       - in: query
 *         name: amount
 *         schema: { type: number, default: 100 }
 *     responses:
 *       200:
 *         description: FX rate calculation
 */
app.get(`${MCP_BASE}/remittance/fx-rate`, async (req, res) => {
    try {
        const { currency } = req.query;
        // Mock rates for common currencies from Bahrain
        const rates = {
            'INR': 220.50,
            'PHP': 150.25,
            'USD': 2.65,
            'EUR': 2.45,
            'GBP': 2.10
        };

        const rate = rates[(currency || '').toUpperCase()] || 0;

        res.json({
            success: true,
            tool: 'remittance_fx_rate',
            currency: currency,
            rate: rate,
            last_updated: new Date()
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// ============================================
// MCP API ENDPOINTS - REWARDS
// ============================================

// 20. Rewards Summary
/**
 * @swagger
 * /api/mcp/rewards/summary:
 *   get:
 *     summary: Get rewards summary
 *     tags: [Rewards]
 *     responses:
 *       200:
 *         description: Points and cashback summary
 */
app.get(`${MCP_BASE}/rewards/summary`, async (req, res) => {
    try {
        const rewards = await getMcpData('rewards');

        let totalPoints = 0;
        let totalCashback = 0;

        rewards.forEach(r => {
            const sheet = (r._sheet || '').toLowerCase();
            const amt = parseAmount(r.Points || r.BHD_Amount || r.Amount || r.amount);

            if (sheet.includes('flyy') || sheet.includes('points')) {
                totalPoints += amt;
            } else {
                totalCashback += amt; // BHD usually
            }
        });

        res.json({
            success: true,
            tool: 'rewards_summary',
            total_points: Math.round(totalPoints),
            total_cashback_bhd: Math.round(totalCashback * 100) / 100,
            // Mock tier
            tier: totalPoints > 10000 ? 'Platinum' : (totalPoints > 5000 ? 'Gold' : 'Silver'),
            next_tier_progress: 75 // Mock
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// 21. Rewards Activity
/**
 * @swagger
 * /api/mcp/rewards/activity:
 *   get:
 *     summary: Get rewards activity history
 *     tags: [Rewards]
 *     parameters:
 *       - in: query
 *         name: period
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: History of earned rewards
 */
app.get(`${MCP_BASE}/rewards/activity`, async (req, res) => {
    try {
        const { period } = req.query;
        const dateRange = parsePeriod(period);

        const rewards = await getMcpData('rewards');

        // Filter by date (look for various date fields)
        const activity = rewards.filter(r => {
            const dateStr = r.Created_At || r.Txn_Date || r.Date || r.timestamp;
            const date = parseDate(dateStr);
            if (!date) return false;

            if (dateRange.start && date < dateRange.start) return false;
            if (dateRange.end && date > dateRange.end) return false;
            return true;
        });

        // Helper to format date properly
        const formatDate = (rawDate) => {
            const date = parseDate(rawDate);
            if (!date || isNaN(date.getTime())) return null;
            // Format as YYYY-MM-DD HH:mm:ss
            const pad = (n) => String(n).padStart(2, '0');
            return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
        };

        // Map to standard format
        const standardActivity = activity.map(r => {
            const rawDate = r.Created_At || r.Txn_Date || r.Date || r.timestamp;
            return {
                date: formatDate(rawDate) || rawDate, // Format the date, fallback to raw if parsing fails
                description: r.Description || r.Txn_Det || r.Event || 'Reward',
                amount: parseAmount(r.Points || r.BHD_Amount || r.Amount || r.amount),
                type: (r._sheet || '').toLowerCase().includes('point') ? 'Points' : 'Cashback'
            };
        }).sort((a, b) => {
            const dateA = parseDate(a.date);
            const dateB = parseDate(b.date);
            return (dateB || 0) - (dateA || 0);
        });

        res.json({
            success: true,
            tool: 'rewards_activity',
            period: dateRange.label,
            count: standardActivity.length,
            activity: standardActivity.slice(0, 50)
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// 22. Expiry Alerts
/**
 * @swagger
 * /api/mcp/rewards/expiry-alerts:
 *   get:
 *     summary: Get expiring rewards alerts
 *     tags: [Rewards]
 *     responses:
 *       200:
 *         description: List of expiring points
 */
app.get(`${MCP_BASE}/rewards/expiry-alerts`, async (req, res) => {
    try {
        // Mock logic: 10% of total points expiring in 30 days
        const rewards = await getMcpData('rewards');

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

// 23. Best Strategy (Recommendation)
/**
 * @swagger
 * /api/mcp/rewards/best-strategy:
 *   get:
 *     summary: Get best rewards strategy for a category
 *     tags: [Rewards]
 *     parameters:
 *       - in: query
 *         name: category
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Recommendation for maximizing rewards
 */
app.get(`${MCP_BASE}/rewards/best-strategy`, async (req, res) => {
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

// ============================================
// MCP API ENDPOINTS - FINANCE AI
// ============================================

// 24. Savings Rate
/**
 * @swagger
 * /api/mcp/finance/savings-rate:
 *   get:
 *     summary: Get savings rate analysis
 *     tags: [Finance]
 *     parameters:
 *       - in: query
 *         name: period
 *         schema: { type: string, default: month }
 *     responses:
 *       200:
 *         description: Savings rate calculation
 */
app.get(`${MCP_BASE}/finance/savings-rate`, async (req, res) => {
    try {
        const { period } = req.query;
        const dateRange = parsePeriod(period || 'month');

        const txns = await getMcpData('transactions');

        let income = 0;
        let expense = 0;

        txns.forEach(t => {
            const date = parseDate(t.transaction_date_time);
            if (!date) return;
            if (dateRange.start && date < dateRange.start) return;
            if (dateRange.end && date > dateRange.end) return;

            const amt = getTxnAmount(t);
            if (isCredit(t)) income += amt;
            else expense += amt;
        });

        const savings = income - expense;
        const rate = income ? (savings / income) * 100 : 0;

        res.json({
            success: true,
            tool: 'get_savings_rate',
            period: dateRange.label,
            total_income: Math.round(income * 100) / 100,
            total_expense: Math.round(expense * 100) / 100,
            savings_amount: Math.round(savings * 100) / 100,
            savings_rate_pct: Math.round(rate * 100) / 100
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// 25. Predict Future Spend
/**
 * @swagger
 * /api/mcp/finance/predict:
 *   get:
 *     summary: Predict future spending
 *     tags: [Finance]
 *     responses:
 *       200:
 *         description: Spending forecast for next month
 */
app.get(`${MCP_BASE}/finance/predict`, async (req, res) => {
    try {
        const { category } = req.query;
        // Logic: Avg of last 3 months
        const txns = await getMcpData('transactions');

        const now = new Date();
        const threeMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 3, 1);

        // Filter by category if needed
        const recentTxns = txns.filter(t => {
            const date = parseDate(t.transaction_date_time);
            if (!date || date < threeMonthsAgo) return false;
            if (t.credit_debit !== 'Debit' && t.credit_debit !== 'D') return false;

            if (category) {
                return (t.MCC_Category || t.mcc_description || '').toLowerCase().includes(category.toLowerCase());
            }
            return true;
        });

        const total = recentTxns.reduce((sum, t) => sum + getTxnAmount(t), 0);
        const monthlyAvg = total / 3;

        res.json({
            success: true,
            tool: 'predict_next_month_spend',
            category: category || 'All Spending',
            predicted_next_month: Math.round(monthlyAvg * 100) / 100,
            confidence: 'High'
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// 26. Optimize Budget
/**
 * @swagger
 * /api/mcp/finance/optimize:
 *   get:
 *     summary: Get budget optimization suggestions
 *     tags: [Finance]
 *     responses:
 *       200:
 *         description: List of potential savings
 */
app.get(`${MCP_BASE}/finance/optimize`, async (req, res) => {
    try {
        const { target_savings } = req.query;
        // Mock suggestions
        const suggestions = [
            "Reduce 'Food & Dining' spend by 15% (Save ~45 BHD)",
            "Cancel 'Netflix' subscription (Save 5 BHD)",
            "Switch daily coffee to home brew (Save ~30 BHD)"
        ];

        res.json({
            success: true,
            tool: 'optimize_budget',
            target: target_savings ? `${target_savings} BHD` : 'Higher Savings',
            suggestions: suggestions
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// 27. Set Smart Alert
const activeAlerts = [];
/**
 * @swagger
 * /api/mcp/finance/set-alert:
 *   post:
 *     summary: Set a financial alert
 *     tags: [Finance]
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               type: { type: string }
 *               threshold: { type: number }
 *     responses:
 *       200:
 *         description: Alert set confirmation
 */
app.post(`${MCP_BASE}/finance/set-alert`, async (req, res) => {
    try {
        const { category, threshold } = req.body; // or query
        // Normally store to DB/Redis
        const alert = { category, threshold, created_at: new Date() };
        activeAlerts.push(alert);

        res.json({
            success: true,
            tool: 'set_spend_alert',
            message: `Alert set for ${category} > ${threshold}`,
            alert_id: activeAlerts.length
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// ============================================
// MCP API ENDPOINTS - UTILITY
// ============================================

// 28. Wallet Balance
/**
 * @swagger
 * /api/mcp/utility/balance:
 *   get:
 *     summary: Get current wallet balance
 *     tags: [Utility]
 *     responses:
 *       200:
 *         description: Current balance
 */
app.get(`${MCP_BASE}/utility/balance`, async (req, res) => {
    try {
        // Get current balance from the latest transaction's available_balance field
        const txns = await getMcpData('transactions');
        
        // Find the latest transaction by date
        let latestTxn = null;
        let latestDate = null;
        
        txns.forEach(t => {
            const dateVal = t.transaction_date_time || t.created_date;
            if (dateVal) {
                const date = parseDate(dateVal);
                if (date && (!latestDate || date > latestDate)) {
                    latestDate = date;
                    latestTxn = t;
                }
            }
        });
        
        // Get balance from the latest transaction
        let balance = 0;
        if (latestTxn) {
            balance = parseFloat(latestTxn.available_balance_in_BHD) || 0;
        }

        res.json({
            success: true,
            tool: 'get_current_balance',
            current_balance: Math.round(balance * 100) / 100,
            currency: 'BHD',
            as_of: latestDate ? latestDate.toISOString() : null
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// 29. Generate Report (PDF/Excel)
/**
 * @swagger
 * /api/mcp/utility/report:
 *   get:
 *     summary: Generate financial report url
 *     tags: [Utility]
 *     parameters:
 *       - in: query
 *         name: type
 *         schema: { type: string, enum: [pdf, excel] }
 *     responses:
 *       200:
 *         description: Download URL for report
 */
app.get(`${MCP_BASE}/utility/report`, async (req, res) => {
    try {
        // Return a mock download link
        res.json({
            success: true,
            tool: 'download_report',
            download_url: "http://localhost:9191/reports/summary_2024.pdf",
            status: "Ready"
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// 30. Explain Category
/**
 * @swagger
 * /api/mcp/utility/explain-category:
 *   get:
 *     summary: Explain a spending category
 *     tags: [Utility]
 *     parameters:
 *       - in: query
 *         name: category
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Explanation of category
 */
app.get(`${MCP_BASE}/utility/explain-category`, async (req, res) => {
    try {
        const { category } = req.query;
        const explanations = {
            "mcc": "Merchant Category Code, used to classify the business.",
            "pos": "Point of Sale - transactions made at a physical card terminal.",
            "ecomm": "E-commerce - online transactions.",
            "atm": "Cash withdrawals from an automated teller machine."
        };

        // fuzzy match
        const key = Object.keys(explanations).find(k => (category || '').toLowerCase().includes(k));
        const explanation = key ? explanations[key] : `Category '${category}' refers to a specific type of spending or merchant classification.`;

        res.json({
            success: true,
            tool: 'explain_category',
            category,
            explanation
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// ============================================
// INITIALIZE AND MOUNT ROUTE FILES
// ============================================

// Helper dependencies to pass to route files
const routeHelpers = {
    EXCEL_FILES,
    readExcelSheet,
    getSheetNames,
    readAllExcelSheets,
    parseDate,
    parsePeriod,
    parseAmount,
    isDateInMonth,
    isDateInRange,
    getMonthFilter,
    getMonthName,
    calculateStats,
    getMcpData,
    getFromCache,
    setToCache,
    generateCacheKey
};

// Initialize route files with helpers
const remittanceRouter = initRemittanceRoutes(routeHelpers);
const transactionsRouter = initTransactionsRoutes(routeHelpers);
const rewardsRouter = initRewardsRoutes(routeHelpers);
const travelBuddyRouter = initTravelBuddyRoutes(routeHelpers);

// Mount routes
// NOTE: The routes below are LEGACY - kept for backward compatibility
// New route files are mounted here but currently not active to avoid conflicts
// To activate new routes, uncomment below and remove corresponding legacy routes:
// app.use('/api/remittance', remittanceRouter);
// app.use('/api/transactions', transactionsRouter);
// app.use('/api/rewards', rewardsRouter);
// app.use('/api/travelbuddy', travelBuddyRouter);

// ============================================
// DATA API ENDPOINTS (Legacy - to be migrated to route files)
// ============================================

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
        const searchPattern = pattern ? `${pattern}*` : '*';

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

        const keys = await redisClient.keys('*');
        
        // Filter to only show our app's keys (exclude system keys)
        const appKeys = keys.filter(k => 
            k.startsWith('remittance:') || 
            k.startsWith('transactions:') || 
            k.startsWith('rewardhistory:') || 
            k.startsWith('travelbuddy:')
        );

        res.json({
            success: true,
            connected: true,
            total_cached_keys: appKeys.length,
            cache_expiry_days: 60,
            keys: appKeys
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
app.listen(port, () => {
    console.log(`Server is running on http://localhost:${port}`);
    console.log('\n🔴 REDIS CACHE:');
    console.log(`  URL: ${REDIS_URL}`);
    console.log(`  Database: ${REDIS_DB}`);
    console.log(`  Cache Expiry: 60 days (2 months)`);
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

        // Calculate summary (case-insensitive)
        const credits = data.filter(item => isCredit(item));
        const debits = data.filter(item => isDebit(item));

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
            if (isCredit(item)) byTransactionType[type].credits++;
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
            let cat = item.MCC_Category;
            if (!cat || typeof cat === 'object') {
                cat = 'Unknown';
            } else {
                cat = String(cat).trim();
            }
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
                domestic_count: filteredTxns.filter(i => (i['Domestic_International'] || '').toUpperCase() === 'DOMESTIC').length,
                international_count: filteredTxns.filter(i => (i['Domestic_International'] || '').toUpperCase() === 'INTERNATIONAL').length,
                pos_count: filteredTxns.filter(i => (i.transactionType_dsc || '').toUpperCase() === 'POS').length,
                ecom_count: filteredTxns.filter(i => (i.transactionType_dsc || '').toUpperCase() === 'ECOM').length
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
        const txnCredits = transactions.filter(i => isCredit(i))
            .reduce((sum, i) => sum + Math.abs(parseFloat(i['Transacted_Amount_in_BHD']) || 0), 0);
        const txnDebits = transactions.filter(i => isDebit(i))
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
            if (isCredit(item)) {
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
            const txnType = (item.transactionType_dsc || '').toUpperCase();
            if (txnType === 'POS') byCountry[country].pos_count++;
            if (txnType === 'ECOM') byCountry[country].ecom_count++;
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
        const { start_date, end_date, source, period } = req.query;

        let data = [];
        if (source === 'travelbuddy') {
            data = await readExcelSheet(EXCEL_FILES.travelbuddy, 'Transactions');
        } else {
            data = await readExcelSheet(EXCEL_FILES.rewards, 'Transactions');
        }

        // Support both period parameter and start_date/end_date
        let dateRange = null;
        if (period) {
            dateRange = parsePeriod(period);
            data = data.filter(item => {
                const itemDate = parseDate(item.Txn_Date);
                if (!itemDate) return false;
                if (dateRange.start && itemDate < dateRange.start) return false;
                if (dateRange.end && itemDate > dateRange.end) return false;
                return true;
            });
        } else if (start_date || end_date) {
            data = data.filter(item => isDateInRange(item.Txn_Date, start_date, end_date));
        }

        const byCategory = {};
        data.forEach(item => {
            // Handle case where MCC_Category might be an object or invalid value
            let category = item.MCC_Category;
            if (!category || typeof category === 'object') {
                category = 'Unknown';
            } else {
                category = String(category).trim();
            }
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
            filters_applied: { 
                period: period ? (dateRange ? dateRange.label : period) : null,
                start_date, 
                end_date, 
                source: source || 'rewards' 
            },
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
