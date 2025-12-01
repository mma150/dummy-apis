# Use Node.js LTS version
FROM node:20-alpine

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production

# Copy application files
COPY server.js ./

# Copy Excel files (data source)
COPY "remittance.xlsx" ./
COPY "transactions.xlsx" ./
COPY "rewardhistory.xlsx" ./
COPY "travelbuddytxn.xlsx" ./

# Expose port
EXPOSE 9191

# Start the server
CMD ["node", "server.js"]
