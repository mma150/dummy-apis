const express = require('express');
const XlsxPopulate = require('xlsx-populate');
const path = require('path');
const app = express();
const PORT = process.env.PORT || 9191;

app.use(express.json());

// Excel password
const EXCEL_PASSWORD = 'BFCxMobi@2468';

// Excel file paths
const EXCEL_FILES = {
    remittance: path.join(__dirname, "Vineet's Remittance.xlsx"),
    transactions: path.join(__dirname, "Vineet's Transactions.xlsx"),
    rewards: path.join(__dirname, "Vineet-Rewards History.xlsx"),
    travelbuddy: path.join(__dirname, "Vineet-TravelBuddy Trxn History.xlsx")
};

// ============================================
// HELPER FUNCTIONS
// ============================================

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
                    obj[header] = value !== undefined ? value : null;
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
        
        // Read data from Excel file
        let data = await readExcelSheet(EXCEL_FILES.remittance);
        
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
        
        res.json({
            success: true,
            message: "Remittance history fetched successfully",
            total_records: data.length,
            data: data
        });
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
        
        // Read data from Excel file
        let data = await readExcelSheet(EXCEL_FILES.transactions);
        
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
        
        res.json({
            success: true,
            message: "Transaction history fetched successfully",
            total_records: data.length,
            data: data
        });
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
        
        // Get all sheet names
        const sheetNames = await getSheetNames(EXCEL_FILES.rewards);
        
        // Read all sheets
        let response = {};
        for (const sheetName of sheetNames) {
            let sheetData = await readExcelSheet(EXCEL_FILES.rewards, sheetName);
            
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
        
        res.json({
            success: true,
            message: "Rewards history fetched successfully",
            sheets: Object.keys(response),
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

// 4. TravelBuddy Transaction History API
app.get('/api/travelbuddy', async (req, res) => {
    try {
        const { customerId, type, country, transactionType } = req.query;
        
        // Get all sheet names
        const sheetNames = await getSheetNames(EXCEL_FILES.travelbuddy);
        
        // Read all sheets
        let response = {};
        for (const sheetName of sheetNames) {
            let sheetData = await readExcelSheet(EXCEL_FILES.travelbuddy, sheetName);
            
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
        
        res.json({
            success: true,
            message: "TravelBuddy transaction history fetched successfully",
            sheets: Object.keys(response),
            data: response
        });
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
        const response = {
            remittance: [],
            transactions: [],
            rewards: {},
            travelbuddy: {}
        };
        
        // Read Remittance
        response.remittance = await readExcelSheet(EXCEL_FILES.remittance);
        
        // Read Transactions
        response.transactions = await readExcelSheet(EXCEL_FILES.transactions);
        
        // Read Rewards (all sheets)
        const rewardsSheets = await getSheetNames(EXCEL_FILES.rewards);
        for (const sheetName of rewardsSheets) {
            const key = sheetName.toLowerCase().replace(/\s+/g, '_');
            response.rewards[key] = await readExcelSheet(EXCEL_FILES.rewards, sheetName);
        }
        
        // Read TravelBuddy (all sheets)
        const travelbuddySheets = await getSheetNames(EXCEL_FILES.travelbuddy);
        for (const sheetName of travelbuddySheets) {
            const key = sheetName.toLowerCase().replace(/\s+/g, '_');
            response.travelbuddy[key] = await readExcelSheet(EXCEL_FILES.travelbuddy, sheetName);
        }
        
        res.json({
            success: true,
            message: "All data fetched successfully",
            data: response
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: "Error fetching all data",
            error: error.message
        });
    }
});

// Health check endpoint
app.get('/api/health', (req, res) => {
    res.json({
        success: true,
        message: "Server is running",
        timestamp: new Date().toISOString(),
        excel_files: EXCEL_FILES
    });
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
    console.log('\nAvailable endpoints:');
    console.log('  GET /api/remittance     - Get remittance history (live from Excel)');
    console.log('  GET /api/transactions   - Get transaction history (live from Excel)');
    console.log('  GET /api/rewards        - Get rewards history (live from Excel)');
    console.log('  GET /api/travelbuddy    - Get TravelBuddy transaction history (live from Excel)');
    console.log('  GET /api/all            - Get all data from all Excel files');
    console.log('  GET /api/sheets         - Get sheet information from all Excel files');
    console.log('  GET /api/health         - Health check');
    console.log('\nExcel files being used:');
    Object.entries(EXCEL_FILES).forEach(([key, path]) => {
        console.log(`  ${key}: ${path}`);
    });
});
